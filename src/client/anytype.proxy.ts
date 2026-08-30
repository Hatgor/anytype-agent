import { randomInt } from "node:crypto";
import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  catchError,
  firstValueFrom,
  from,
  map,
  Observable,
  of,
  Subject,
  switchMap,
  tap,
} from "rxjs";
import type { HostConfig } from "../app.config";
import type { AnytypeClient } from "./anytype.client";
import { ANYTYPE_CLIENT } from "./client.constants";
import { SPACE_ROUTES_DOC } from "./routes";

export type ProxyTrace = {
  alias: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  error?: string;
};

@Injectable()
export class AnytypeProxy implements OnModuleDestroy {
  private readonly logger = new Logger(this.constructor.name);
  private readonly spaceAliases = new Map<string, string>();
  private readonly ALIAS_REGEX = /^\/v1\/spaces\/(\d{6})(\/.*)?$/;

  private server?: ReturnType<typeof Bun.serve>;

  readonly routesDoc = SPACE_ROUTES_DOC;
  readonly traces$ = new Subject<ProxyTrace>();

  constructor(
    private readonly config: ConfigService<HostConfig, true>,
    @Inject(ANYTYPE_CLIENT) private readonly client: AnytypeClient,
  ) {}

  async start(): Promise<void> {
    const port = this.config.get("HOST_PROXY_PORT");
    const targetUrl = this.config.get("ANYTYPE_API_URL");

    try {
      this.server = Bun.serve({
        port,
        fetch: (req) => firstValueFrom(this.proxyRequest$(req)),
      });

      this.logger.log(
        `🚀 Started reverse proxy on http://127.0.0.1:${this.server.port} -> ${targetUrl}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`❌ Failed to start proxy on port ${port}: ${msg}`);
      throw err;
    }
  }

  stop(): void {
    if (this.server) {
      this.server.stop(true);
      this.server = undefined;
      this.logger.log(`🛑 Reverse proxy stopped`);
    }
  }

  onModuleDestroy(): void {
    this.stop();
  }

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

        if (!alias || !spaceId) {
          throw this.NOT_FOUND;
        }

        const targetUrl = `${url.pathname.replace(alias, spaceId)}${url.search}`;

        return { req, alias, targetUrl, startTime };
      }),
      switchMap((ctx) => {
        const {
          req: { method, body },
          targetUrl,
        } = ctx;

        return from(this.client.requestRaw(targetUrl, { method, body })).pipe(
          map((res) => ({ ...ctx, res })),
        );
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

  /**
   * Выдаёт 6-значный алиас вместо настоящего spaceId для одной LLM-джобы.
   *
   * SSOT жизненного цикла: алиас живёт ровно пока живёт ран — выдаётся в начале
   * run() и отзывается через finalize на всех путях выхода (complete/error/unsubscribe).
   * TTL здесь не нужен и вреден: второй источник правды о времени смерти алиаса
   * роняет длинные раны 404-ми посреди работы. SpaceId (алиасный и настоящий) —
   * не секрет: без API-ключа он бесполезен, мимо прокси агент не ходит.
   */
  issueSpaceAlias(spaceId: string): string {
    let alias: string;
    do {
      alias = randomInt(100_000, 1_000_000).toString();
    } while (this.spaceAliases.has(alias));

    this.spaceAliases.set(alias, spaceId);
    return alias;
  }

  revokeSpaceAlias(alias: string): void {
    this.spaceAliases.delete(alias);
  }

  private get NOT_FOUND(): Response {
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
}
