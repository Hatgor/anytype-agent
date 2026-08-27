import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AppConfig } from "../app.config";

// TODO: аутентификация прокси короткоживущими токенами:
// HostModelService на старте LLM-запроса регистрирует UUID-токен в памяти прокси (Map<token, spaceId>)
// и вклеивает его в промпт — агент отправляет токен в каждом curl-запросе к прокси.
// Без валидного токена — 401. Привязка к spaceId скоупит запросы агента его собственным спейсом.
@Injectable()
export class ProxyService implements OnApplicationBootstrap, OnApplicationShutdown {
  private server?: ReturnType<typeof Bun.serve>;
  private readonly logger = new Logger(ProxyService.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  onApplicationBootstrap() {
    const anytypeUrl = this.config.get("ANYTYPE_API_URL");
    const apiKey = this.config.get("ANYTYPE_API_KEY");
    const logger = this.logger;

    try {
      this.server = Bun.serve({
        port: 31013,
        async fetch(req) {
          const startTime = performance.now();
          const url = new URL(req.url);
          const targetUrl = `${anytypeUrl}${url.pathname}${url.search}`;
          const method = req.method;
          const pathWithQuery = `${url.pathname}${url.search}`;

          let requestBody: string | undefined;
          let bodyToSend: string | undefined;

          if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
            requestBody = await req.text();
            bodyToSend = requestBody;
          }

          logger.log(
            `🌐 [Proxy] ${method} ${pathWithQuery}${
              requestBody ? `\n📦 Request Body: ${requestBody.slice(0, 500)}` : ""
            }`,
          );

          try {
            const response = await fetch(targetUrl, {
              method,
              headers: {
                ...Object.fromEntries(req.headers),
                Authorization: `Bearer ${apiKey}`,
                "Anytype-Version": "2025-11-08",
              },
              body: bodyToSend,
            });

            const duration = Math.round(performance.now() - startTime);
            const status = response.status;
            const statusText = response.statusText || "";

            const responseBody = await response.text();

            if (response.ok) {
              logger.log(
                `✅ [Proxy] ${status} ${statusText} in ${duration}ms (${method} ${pathWithQuery})\n📄 Response: ${responseBody.slice(0, 300)}`,
              );
            } else {
              logger.warn(
                `⚠️ [Proxy] ${status} ${statusText} in ${duration}ms (${method} ${pathWithQuery})\n❌ Error Body: ${responseBody}`,
              );
            }

            return new Response(responseBody, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
          } catch (err: unknown) {
            const duration = Math.round(performance.now() - startTime);
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(
              `❌ [Proxy] Network error after ${duration}ms (${method} ${pathWithQuery}): ${msg}`,
            );
            return new Response(JSON.stringify({ error: msg }), {
              status: 502,
              headers: { "Content-Type": "application/json" },
            });
          }
        },
      });
      this.logger.log(
        `🚀 [ProxyService] Started reverse proxy on http://127.0.0.1:31013 -> ${anytypeUrl}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`⚠️ [ProxyService] Could not start proxy on port 31013: ${msg}`);
    }
  }

  onApplicationShutdown() {
    this.server?.stop();
  }
}
