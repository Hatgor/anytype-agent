import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { $ } from "bun";
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

  run(spaceId: string, payload: object): Observable<LlmEvent> {
    const alias = this.proxy.issueSpaceAlias(spaceId);

    const response$ = this.getResponse(payload, alias).pipe(share());
    const done$ = response$.pipe(ignoreElements(), endWith(null));

    const traces$: Observable<LlmAction> = this.proxy.traces$.pipe(
      filter((t) => t.alias === alias),
      map((t) => LlmAction.create(`${t.method} ${t.path.split(alias)[1] || "/"} → ${t.status}`)),
      catchError(() => EMPTY), // телеметрия не роняет джобу
      takeUntil(done$), // ответ получен → телеметрия стоп
    );

    return merge(
      traces$,
      response$.pipe(map((text) => LlmResponse.create(text))),
      // keep multiline
    ).pipe(finalize(() => this.proxy.revokeSpaceAlias(alias)));
  }

  private getResponse(event: object, spaceAlias: string): Observable<string> {
    return defer(async () => {
      const prompt = buildHostPrompt(
        event,
        this.config.get("ANYTYPE_BOT_NAME"),
        `http://127.0.0.1:${this.config.get("HOST_PROXY_PORT")}`,
        this.proxy.routesDoc,
        spaceAlias,
      );

      this.logger.log(`🤖 Executing host agent via SSH (prompt length: ${prompt.length} chars)...`);

      // TODO: флаги специфичны для Antigravity CLI — по сервису на каждый инструмент?
      // TODO: передавать конфиг в аргументах, чтобы Agy брал самую быструю модель

      // Флаги: --dangerously-skip-permissions (headless вызовы инструментов без TTY),
      // --disable-slash-commands (парсер слэш-команд не съедает URL /v1/spaces);
      // $(cat) — промпт из STDIN без base64 и шелл-экранирования.
      const remoteCommand = `export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"; ${this.cliBin} -p "$(cat)" --dangerously-skip-permissions --disable-slash-commands`;

      const { stdout, stderr } = await this.execRemote(remoteCommand, prompt, 120_000);

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

  private async execRemote(
    remoteCommand: string,
    stdinText?: string,
    timeoutMs = 120_000,
  ): Promise<{ stdout: string; stderr: string }> {
    const sshCreds = `${this.config.get("HOST_SSH_USER")}@${this.config.get("HOST_SSH_HOST")}`;
    const input = new Response(stdinText ?? "");

    const runShell = $`ssh -T -i ${this.config.get("HOST_SSH_KEY_PATH")} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -o LogLevel=ERROR ${sshCreds} ${remoteCommand} < ${input}`;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`[HostModel] Command timed out after ${timeoutMs}ms: ${remoteCommand}`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([runShell.quiet().nothrow(), timeoutPromise]);

      const stdoutText = result.stdout.toString();
      const stderrText = result.stderr.toString();

      if (result.exitCode !== 0) {
        throw new Error(
          `Command failed with exit code ${result.exitCode}:\nSTDERR: ${stderrText}\nSTDOUT: ${stdoutText}`,
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
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
