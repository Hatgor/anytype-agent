import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { createParser } from "eventsource-parser";
import { defer, firstValueFrom, from, type Observable, timer } from "rxjs";
import { finalize, retry, tap } from "rxjs/operators";
import type { Static, TSchema } from "typebox";
import Value from "typebox/value";
import type { AppConfig } from "../app.config";

/**
 * Low-level HTTP and SSE transport client for Anytype daemon.
 * Knows NOTHING about domain entities (spaces, chats, types).
 * Strictly responsible for transport, headers, authentication, resilience, and SSE streaming.
 */
export class AnytypeClient {
  constructor(
    private readonly logger: Logger,
    readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly apiVersion: string = "2025-11-08",
  ) {}

  async request<T extends TSchema>(
    schema: T,
    path: string,
    init: RequestInit = {},
  ): Promise<Static<T>> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Anytype-Version": this.apiVersion,
      Authorization: `Bearer ${this.apiKey}`,
      ...(init.headers as Record<string, string>),
    };

    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`[AnytypeClient] Connection failed to ${url}: ${message}`);
    }

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new Error(
        `[AnytypeClient ${res.status}] ${res.statusText}: ${errorBody || "Request failed"}`,
      );
    }

    let raw: unknown;
    try {
      raw = await res.json();
    } catch (jsonErr: unknown) {
      const message = jsonErr instanceof Error ? jsonErr.message : String(jsonErr);
      throw new Error(`[AnytypeClient] Failed to parse JSON response from ${path}: ${message}`);
    }

    try {
      return Value.Parse(schema, raw);
    } catch (_err: unknown) {
      const errors = [...Value.Errors(schema, raw)]
        .map((e) => `  - ${e.instancePath || "/"}: ${e.message} (schema: ${e.schemaPath})`)
        .join("\n");
      throw new Error(
        `[AnytypeClient] Schema validation failed for response from ${path}:\n${errors}`,
      );
    }
  }

  async get<T extends TSchema>(schema: T, path: string, init?: RequestInit): Promise<Static<T>> {
    return this.request(schema, path, { ...init, method: "GET" });
  }

  async post<T extends TSchema>(
    schema: T,
    path: string,
    body?: unknown,
    init?: RequestInit,
  ): Promise<Static<T>> {
    return this.request(schema, path, {
      ...init,
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T extends TSchema>(schema: T, path: string, init?: RequestInit): Promise<Static<T>> {
    return this.request(schema, path, { ...init, method: "DELETE" });
  }

  /**
   * Generic SSE stream subscriber. Emits raw parsed events as an Observable.
   */
  stream(path: string): Observable<{ event?: string; data: unknown }> {
    return defer(() => {
      const abortController = new AbortController();
      const stream$ = from(this.fetchEventStream(path, abortController.signal));

      return stream$.pipe(
        finalize(() => {
          this.logger.log(`🛑 [AnytypeClient SSE] Finalizing and aborting connection for ${path}`);
          abortController.abort();
        }),
      );
    });
  }

  /**
   * Private async generator that connects to the SSE endpoint and yields parsed events.
   */
  private async *fetchEventStream(
    path: string,
    signal: AbortSignal,
  ): AsyncGenerator<{ event?: string; data: unknown }> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = {
      Accept: "text/event-stream",
      "Anytype-Version": this.apiVersion,
      Authorization: `Bearer ${this.apiKey}`,
    };

    this.logger.log(`🔌 [AnytypeClient SSE] Initiating connection to: ${url}`);

    let res: Response;
    try {
      res = await fetch(url, { headers, signal });
    } catch (err: unknown) {
      if (signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`❌ [AnytypeClient SSE] Network failure connecting to ${url}: ${message}`);
      throw err;
    }

    if (!res.ok || !res.body) {
      const errorBody = await res.text().catch(() => "");
      throw new Error(
        `[AnytypeClient SSE ${res.status}] Failed to connect: ${errorBody || res.statusText}`,
      );
    }

    this.logger.log(`✅ [AnytypeClient SSE] Stream established with status ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const queue: { event?: string; data: unknown }[] = [];

    const parser = createParser({
      onEvent(event) {
        if (event.data === undefined) return;
        let parsedData: unknown;
        try {
          parsedData = JSON.parse(event.data);
        } catch {
          parsedData = event.data;
        }
        queue.push({ event: event.event, data: parsedData });
      },
    });

    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        const decodedText = decoder.decode(value, { stream: true });
        parser.feed(decodedText);
        while (queue.length > 0) {
          const item = queue.shift();
          if (item) yield item;
        }
      }
    } catch (readErr: unknown) {
      if (!signal.aborted) {
        throw readErr;
      }
    } finally {
      try {
        await reader.cancel().catch(() => {});
      } catch {
        // ignore cancel error
      }
      reader.releaseLock();
      this.logger.log(`🔒 [AnytypeClient SSE] Reader lock released for ${path}`);
    }
  }

  /**
   * Healthcheck helper verifying basic connectivity to the API endpoint.
   * Fails fast on 401/403 authentication errors.
   */
  async checkHealth(
    healthcheckPath = "/v1/spaces",
    maxAttempts = 10,
    intervalMs = 2000,
  ): Promise<void> {
    const ready$ = defer(() =>
      fetch(`${this.baseUrl}${healthcheckPath}`, {
        headers: {
          "Anytype-Version": this.apiVersion,
          Authorization: `Bearer ${this.apiKey}`,
        },
      }),
    ).pipe(
      tap((res) => {
        if (res.status === 401 || res.status === 403) {
          throw new Error(`[AnytypeClient] Authentication failed with status ${res.status}`);
        }
        if (!res.ok) {
          throw new Error(`[AnytypeClient] Healthcheck returned status ${res.status}`);
        }
      }),
      retry({
        count: maxAttempts - 1,
        delay: (error: unknown, retryCount: number) => {
          const msg = error instanceof Error ? error.message : String(error);
          if (msg.includes("Authentication failed")) {
            throw error; // Fail immediately on bad credentials
          }
          this.logger.log(
            `⏳ [AnytypeClient] Waiting for Anytype API (${this.baseUrl})... (attempt ${retryCount}/${maxAttempts})`,
          );
          return timer(intervalMs);
        },
      }),
      tap(() => {
        this.logger.log(
          `✅ [AnytypeClient] Successfully connected to Anytype API at ${this.baseUrl}`,
        );
      }),
    );

    try {
      await firstValueFrom(ready$);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[AnytypeClient] API at ${this.baseUrl} is still unreachable after ${maxAttempts} attempts: ${message}`,
      );
    }
  }

  static async factory(config: ConfigService<AppConfig, true>) {
    const log = new Logger("AnytypeClientFactory");
    const apiUrl = config.get("ANYTYPE_API_URL", { infer: true });
    const apiKey = config.get("ANYTYPE_API_KEY", { infer: true });

    log.log(`Initializing Anytype client for ${apiUrl}...`);
    const client = new AnytypeClient(log, apiUrl.replace(/\/$/, ""), apiKey);

    // Healthcheck: ensures API is reachable and token is valid before app bootstrap completes
    await client.checkHealth();
    log.log(`Anytype client verified and ready at ${apiUrl}`);
    return client;
  }
}
