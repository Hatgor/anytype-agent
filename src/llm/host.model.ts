import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  catchError,
  defer,
  EMPTY,
  endWith,
  filter,
  finalize,
  ignoreElements,
  map,
  merge,
  type Observable,
  share,
  takeUntil,
} from "rxjs";
import type { HostConfig } from "../app.config";
import { AnytypeProxy } from "../client/anytype.proxy";
import { buildHostPrompt } from "./prompts/host";
import { AbstractLlmService, LlmAction, type LlmEvent, LlmResponse } from "./types";

export class LlmEmptyResponseError extends Error {
  constructor(message = "LLM returned empty or whitespace-only response") {
    super(message);
    this.name = "LlmEmptyResponseError";
  }
}

@Injectable()
export class HostModelService extends AbstractLlmService {
  private readonly cliBin: string;

  constructor(
    private readonly config: ConfigService<HostConfig, true>,
    private readonly proxy: AnytypeProxy,
  ) {
    super();
    this.cliBin = this.config.get("HOST_CLI_BIN");
  }

  async init(): Promise<void> {
    this.logger.log(`🔍 Verifying host agent availability ("${this.cliBin}")...`);
    await this.execRemote(`${this.cliBin} --help`, undefined, 15_000);
    this.logger.log(`✅ Host agent "${this.cliBin}" verified successfully`);

    await this.proxy.start();
    this.logger.log(`✅ Proxy started`);
  }

  run(spaceId: string, payload: object, abort?: AbortSignal): Observable<LlmEvent> {
    const alias = this.proxy.issueSpaceAlias(spaceId);

    const response$ = this.getResponse(payload, alias, abort).pipe(share());
    const done$ = response$.pipe(ignoreElements(), endWith(null));

    const traces$: Observable<LlmAction> = this.proxy.traces$.pipe(
      filter((t) => t.alias === alias),
      map((t) => LlmAction.create(`${t.method} ${t.path.split(alias)[1] || "/"} → ${t.status}`)),
      catchError(() => EMPTY), // telemetry errors do not crash the job
      takeUntil(done$), // response received → stop telemetry
    );

    return merge(
      traces$,
      response$.pipe(map((text) => LlmResponse.create(text))),
      // keep multiline
    ).pipe(finalize(() => this.proxy.revokeSpaceAlias(alias)));
  }

  private getResponse(event: object, spaceAlias: string, abort?: AbortSignal): Observable<string> {
    return defer(async () => {
      if (abort?.aborted) {
        throw new Error("[HostModel] Execution aborted before start");
      }

      const prompt = buildHostPrompt(
        event,
        this.config.get("ANYTYPE_BOT_NAME"),
        `http://127.0.0.1:${this.config.get("HOST_PROXY_PORT")}`,
        this.proxy.routesDoc,
        spaceAlias,
      );

      this.logger.log(`🤖 Executing host agent via SSH (prompt length: ${prompt.length} chars)...`);

      // TODO: flags are specific to Antigravity CLI — separate service for each tool?
      // TODO: pass config in arguments so Agy selects the fastest model

      // Flags: --dangerously-skip-permissions (headless tool invocation without TTY),
      // --disable-slash-commands (slash command parser won't consume /v1/spaces URL);
      // $(cat) — prompt from STDIN without base64 or shell escaping.
      const remoteCommand = `export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"; ${this.cliBin} -p "$(cat)" --dangerously-skip-permissions --disable-slash-commands`;

      const { stdout, stderr } = await this.execRemote(remoteCommand, prompt, 120_000, abort);

      const trimmed = stdout.trim();
      if (!trimmed) {
        this.logger.error(`❌ Empty LLM response! Stderr output:\n${stderr || "<none>"}`);
        throw new LlmEmptyResponseError(
          `LLM process exited cleanly (code 0) but returned empty stdout. Stderr: ${stderr || "empty"}`,
        );
      }

      this.logger.log(`✅ Response received (${trimmed.length} characters)`);
      return trimmed;
    });
  }

  protected buildSshArgs(remoteCommand: string): string[] {
    const sshCreds = `${this.config.get("HOST_SSH_USER")}@${this.config.get("HOST_SSH_HOST")}`;
    return [
      "ssh",
      "-T",
      "-i",
      this.config.get("HOST_SSH_KEY_PATH"),
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "ConnectTimeout=5",
      "-o",
      "LogLevel=ERROR",
      sshCreds,
      remoteCommand,
    ];
  }

  private async execRemote(
    remoteCommand: string,
    stdinText?: string,
    timeoutMs = 120_000,
    abort?: AbortSignal,
  ): Promise<{ stdout: string; stderr: string }> {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = abort ? AbortSignal.any([abort, timeoutSignal]) : timeoutSignal;

    const proc = Bun.spawn(this.buildSshArgs(remoteCommand), {
      stdin: Buffer.from(stdinText ?? ""),
      stdout: "pipe",
      stderr: "pipe",
      signal,
      killSignal: "SIGKILL",
    });

    try {
      const [stdoutText, stderrText, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      if (abort?.aborted) {
        throw new Error("[HostModel] Execution aborted");
      }

      if (timeoutSignal.aborted) {
        throw new Error(`[HostModel] Command timed out after ${timeoutMs}ms: ${remoteCommand}`);
      }

      if (exitCode !== 0) {
        throw new Error(
          `Command failed with exit code ${exitCode}:\nSTDERR: ${stderrText}\nSTDOUT: ${stdoutText}`,
        );
      }

      return {
        stdout: stdoutText,
        stderr: stderrText,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`❌ [HostModel] Exec error: ${msg}`);
      throw err;
    }
  }
}
