import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { $ } from "bun";
import type { HostConfig } from "../app.config";
import type { AgentEvent } from "../observer/types";
import { buildHostPrompt } from "./prompts/host";
import { AbstractLlmService } from "./types";

export class LlmEmptyResponseError extends Error {
  constructor(message = "LLM returned empty or whitespace-only response") {
    super(message);
    this.name = "LlmEmptyResponseError";
  }
}

@Injectable()
export class HostModelService extends AbstractLlmService {
  private readonly logger = new Logger(HostModelService.name);
  private readonly cliBin: string;

  constructor(private readonly config: ConfigService<HostConfig, true>) {
    super();
    this.cliBin = this.config.get("HOST_CLI_BIN");
  }

  async init(): Promise<void> {
    this.logger.log(`🔍 [HostModel] Verifying host agent availability ("${this.cliBin}")...`);
    await this.execRemote(`${this.cliBin} --help`, undefined, 15_000);
    this.logger.log(`✅ [HostModel] Host agent "${this.cliBin}" verified successfully`);
  }

  async generateResponse(event: AgentEvent): Promise<string> {
    const prompt = buildHostPrompt(event, this.config.get("ANYTYPE_BOT_NAME"));

    this.logger.log(
      `🤖 [HostModel] Executing host agent via SSH (prompt length: ${prompt.length} chars)...`,
    );

    // TODO: Это флаги специфичные для Antigravity CLI...
    // Неужели придется делать по сервису на каждый инструмент...
    // TODO: передавать конфиг в аргументах чтобы Agy использовал самую быструю модель

    // Флаги:
    // --dangerously-skip-permissions: разрешает headless вызовы инструментов (curl к прокси) без висения на TTY
    // --disable-slash-commands: защищает URL-пути /v1/spaces от парсера слэш-команд
    // $(cat) безопасно считывает промпт из STDIN без base64 и шелл-экранирования
    const remoteCommand = `export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"; ${this.cliBin} -p "$(cat)" --dangerously-skip-permissions --disable-slash-commands`;

    const { stdout, stderr } = await this.execRemote(remoteCommand, prompt, 120_000);

    const trimmed = stdout.trim();
    if (!trimmed) {
      this.logger.error(`❌ [HostModel] Empty LLM response! Stderr output:\n${stderr || "<none>"}`);
      throw new LlmEmptyResponseError(
        `LLM process exited cleanly (code 0) but returned empty stdout. Stderr: ${stderr || "empty"}`,
      );
    }

    this.logger.log(`✅ [HostModel] Response received (${trimmed.length} characters)`);
    return trimmed;
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
