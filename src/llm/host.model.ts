import { randomInt } from "node:crypto";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { $ } from "bun";
import {
  catchError,
  defer,
  EMPTY,
  endWith,
  filter,
  finalize,
  firstValueFrom,
  from,
  ignoreElements,
  map,
  merge,
  type Observable,
  of,
  Subject,
  share,
  switchMap,
  takeUntil,
  tap,
} from "rxjs";
import type { HostConfig } from "../app.config";
import { buildHostPrompt } from "./prompts/host";
import {
  AbstractLlmService,
  LlmAction,
  type LlmApiTrace,
  type LlmEvent,
  LlmResponse,
} from "./types";

export class LlmEmptyResponseError extends Error {
  constructor(message = "LLM returned empty or whitespace-only response") {
    super(message);
    this.name = "LlmEmptyResponseError";
  }
}

@Injectable()
export class HostModelService extends AbstractLlmService implements OnModuleDestroy {
  private server?: ReturnType<typeof Bun.serve>;
  private readonly traces$ = new Subject<LlmApiTrace>();
  private readonly cliBin: string;
  private readonly spaceAliases = new Map<string, string>();

  constructor(private readonly config: ConfigService<HostConfig, true>) {
    super();
    this.cliBin = this.config.get("HOST_CLI_BIN");
  }

  async init(): Promise<void> {
    this.logger.log(`🔍 Verifying host agent availability ("${this.cliBin}")...`);
    await this.execRemote(`${this.cliBin} --help`, undefined, 15_000);
    this.logger.log(`✅ Host agent "${this.cliBin}" verified successfully`);

    this.startProxy();
    this.logger.log(`✅ Proxy started`);
  }

  run(spaceId: string, payload: object): Observable<LlmEvent> {
    const alias = this.issueSpaceAlias(spaceId);

    const response$ = this.getResponse(payload, alias).pipe(share());
    const done$ = response$.pipe(ignoreElements(), endWith(null));

    const traces$: Observable<LlmAction> = this.traces$.pipe(
      filter((t) => t.alias === alias),
      map((t) => LlmAction.create(`${t.method} ${t.path.split(alias)[1] || "/"} → ${t.status}`)),
      catchError(() => EMPTY), // телеметрия не роняет джобу
      takeUntil(done$), // ответ получен → телеметрия стоп
    );

    return merge(
      traces$,
      response$.pipe(map((text) => LlmResponse.create(text))),
      // keep multiline
    ).pipe(finalize(() => this.revokeSpaceAlias(alias)));
  }

  private getResponse(event: object, spaceAlias: string): Observable<string> {
    return defer(async () => {
      const prompt = buildHostPrompt(
        event,
        this.config.get("ANYTYPE_BOT_NAME"),
        "http://host.docker.internal:31013",
        spaceAlias,
      );

      this.logger.log(`🤖 Executing host agent via SSH (prompt length: ${prompt.length} chars)...`);

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

  /**
   * Захват ресурса: выделяем уникальный 6-значный алиас
   */
  private issueSpaceAlias(spaceId: string): string {
    let alias: string;
    do {
      alias = randomInt(100_000, 1_000_000).toString();
    } while (this.spaceAliases.has(alias));

    this.spaceAliases.set(alias, spaceId);
    return alias;
  }

  /**
   * Освобождение ресурса
   */
  private revokeSpaceAlias(alias: string): void {
    this.spaceAliases.delete(alias);
  }

  private readonly ALIAS_REGEX = /^\/v1\/spaces\/(\d{6})(\/.*)?$/;
  private parseAlias(pathname: string): string | null {
    const match = this.ALIAS_REGEX.exec(pathname);
    return match?.[1] ?? null;
  }

  private proxyRequest$(req: Request): Observable<Response> {
    return of({ req, startTime: performance.now() }).pipe(
      map(({ req, startTime }) => {
        const url = new URL(req.url);
        const alias = this.parseAlias(url.pathname);
        const spaceId = alias ? this.spaceAliases.get(alias) : null;

        if (!alias || !spaceId) throw this.NOT_FOUND;

        const targetUrl = `${this.config.get("ANYTYPE_API_URL")}${url.pathname.replace(alias, spaceId)}${url.search}`;
        const headers = new Headers(req.headers);
        headers.set("Authorization", `Bearer ${this.config.get("ANYTYPE_API_KEY")}`);
        headers.set("Anytype-Version", "2025-11-08");

        return { req, alias, targetUrl, headers, startTime };
      }),
      switchMap((ctx) => {
        const {
          req: { method, body },
          targetUrl,
          headers,
        } = ctx;

        return from(
          fetch(targetUrl, {
            method,
            headers,
            body,
          }),
        ).pipe(map((res) => ({ ...ctx, res })));
      }),
      tap(({ alias, req, res, startTime }) => {
        this.traces$.next({
          alias,
          method: req.method,
          path: new URL(req.url).pathname,
          status: res.status,
          durationMs: performance.now() - startTime,
        });
      }),
      map(({ res }) => res),
      catchError((err) => {
        if (err instanceof Response) {
          this.logger.warn(
            `⚠️ Proxy rejected [${err.status}]: ${req.method} ${new URL(req.url).pathname}`,
          );
          return of(err);
        }

        this.logger.error(`❌ Proxy error: ${err instanceof Error ? err.message : String(err)}`);
        return of(new Response(null, { status: 500 }));
      }),
    );
  }

  private startProxy() {
    const anytypeUrl = this.config.get("ANYTYPE_API_URL");

    try {
      this.server = Bun.serve({
        port: 31013,
        fetch: (req) => firstValueFrom(this.proxyRequest$(req)),
      });

      this.logger.log(`🚀 Started reverse proxy on http://127.0.0.1:31013 -> ${anytypeUrl}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`⚠️ Could not start proxy on port 31013: ${msg}`);
    }
  }

  private get NOT_FOUND(): Response {
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  onModuleDestroy() {
    if (this.server) {
      this.server.stop();
      this.logger.log(`🛑 [ProxyService] Proxy stopped`);
    }
  }
}
