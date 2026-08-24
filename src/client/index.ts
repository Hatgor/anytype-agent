import { type TSchema, type Static } from "typebox";
import Value from "typebox/value";
import { defer, firstValueFrom, timer, Observable, from } from "rxjs";
import { retry, tap, finalize } from "rxjs/operators";
import { createParser } from "eventsource-parser";
import type { AppConfig } from "../config/schema";
import {
  Space,
  SpacesResponse,
  SpaceResponse,
  Member,
  MembersResponse,
  MemberResponse,
  Chat,
  ChatsResponse,
  ChatResponse,
  CreateChatRequest,
  ChatMessage,
  ChatMessageResponse,
  AddChatMessageRequest,
  AnytypeType,
  TypesResponse,
  TypeResponse,
  CreateTypeRequest,
  AnytypeObject,
  ObjectsResponse,
  ObjectWithBody,
  ObjectResponse,
  SearchRequest,
} from "./schemas";

export * from "./schemas";

export class AnytypeClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiVersion: string;

  constructor(config: AppConfig, apiVersion = "2025-11-08") {
    this.baseUrl = config.ANYTYPE_API_URL.replace(/\/$/, "");
    this.apiKey = config.ANYTYPE_API_KEY;
    this.apiVersion = apiVersion;
  }

  private async request<T extends TSchema>(
    schema: T,
    path: string,
    options: RequestInit = {}
  ): Promise<Static<T>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Anytype-Version": this.apiVersion,
      Authorization: `Bearer ${this.apiKey}`,
      ...(options.headers as Record<string, string> | undefined),
    };

    const url = `${this.baseUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        ...options,
        headers,
      });
    } catch (err: any) {
      throw new Error(`[AnytypeClient] Connection failed to ${url}: ${err.message}`);
    }

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new Error(
        `[AnytypeClient HTTP ${res.status}] ${options.method || "GET"} ${path}: ${errorBody || res.statusText}`
      );
    }

    const raw = await res.json();
    try {
      return Value.Parse(schema, raw);
    } catch (err: any) {
      const errors = [...Value.Errors(schema, raw)]
        .map((e) => `  - ${e.instancePath || "/"}: ${e.message} (schema: ${e.schemaPath})`)
        .join("\n");
      throw new Error(
        `[AnytypeClient] Schema validation failed for ${path}:\n${errors}\nPayload: ${JSON.stringify(raw, null, 2)}`
      );
    }
  }

  /**
   * Waits for Anytype API to become available and accept requests using RxJS retry pipeline.
   */
  async waitForReady(maxAttempts = 30, intervalMs = 1000): Promise<void> {
    const ready$ = defer(() => this.getSpaces()).pipe(
      retry({
        count: maxAttempts - 1,
        delay: (error, retryCount) => {
          console.log(
            `⏳ [AnytypeClient] Waiting for Anytype API (${this.baseUrl})... (attempt ${retryCount}/${maxAttempts})`
          );
          return timer(intervalMs);
        },
      }),
      tap(() => {
        console.log(`✅ [AnytypeClient] Successfully connected to Anytype API at ${this.baseUrl}`);
      })
    );

    try {
      await firstValueFrom(ready$);
    } catch (err: any) {
      throw new Error(
        `[AnytypeClient] API at ${this.baseUrl} is still unreachable after ${maxAttempts} attempts: ${err.message}`
      );
    }
  }

  // --- Spaces ---

  async getSpaces(): Promise<Space[]> {
    const res = await this.request(SpacesResponse, "/v1/spaces");
    return res.data;
  }

  async getSpace(spaceId: string): Promise<Space> {
    const res = await this.request(SpaceResponse, `/v1/spaces/${encodeURIComponent(spaceId)}`);
    return res.space;
  }

  // --- Members & Permissions ---

  async getMembers(spaceId: string): Promise<Member[]> {
    const res = await this.request(
      MembersResponse,
      `/v1/spaces/${encodeURIComponent(spaceId)}/members`
    );
    return res.data;
  }

  async getMember(spaceId: string, memberId: string): Promise<Member> {
    const res = await this.request(
      MemberResponse,
      `/v1/spaces/${encodeURIComponent(spaceId)}/members/${encodeURIComponent(memberId)}`
    );
    return res.member;
  }

  // --- Chats & Messages ---

  async getChats(spaceId: string): Promise<Chat[]> {
    const res = await this.request(
      ChatsResponse,
      `/v1/spaces/${encodeURIComponent(spaceId)}/chats`
    );
    return res.data;
  }

  async createChat(payload: CreateChatRequest): Promise<Chat> {
    const res = await this.request(
      ChatResponse,
      `/v1/spaces/${encodeURIComponent(payload.space_id)}/chats`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
    return res.chat;
  }

  async addChatMessage(payload: AddChatMessageRequest): Promise<ChatMessage> {
    const res = await this.request(
      ChatMessageResponse,
      `/v1/spaces/${encodeURIComponent(payload.space_id)}/chats/${encodeURIComponent(payload.chat_id)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ text: payload.text, reply_to_message_id: payload.reply_to_message_id }),
      }
    );
    return res.message;
  }

  /**
   * Subscribes to chat SSE message stream and returns an Observable of raw SSE events.
   * Automatically aborts the HTTP connection when the subscriber unobserves.
   */
  subscribeChatMessages(
    spaceId: string,
    chatId: string
  ): Observable<{ event?: string; data: any }> {
    return defer(() => {
      const abortController = new AbortController();
      const url = `${this.baseUrl}/v1/spaces/${encodeURIComponent(spaceId)}/chats/${encodeURIComponent(chatId)}/messages/stream`;
      const headers = {
        Accept: "text/event-stream",
        "Anytype-Version": this.apiVersion,
        Authorization: `Bearer ${this.apiKey}`,
      };

      console.log(`🔌 [AnytypeClient SSE] Initiating connection to: ${url}`);

      const stream$ = from(
        (async function* () {
          let res: Response;
          try {
            res = await fetch(url, { headers, signal: abortController.signal });
          } catch (err: any) {
            console.error(`❌ [AnytypeClient SSE] Network failure connecting to ${url}: ${err.message}`);
            throw new Error(`[AnytypeClient SSE] Connection failed to ${url}: ${err.message}`);
          }

          if (!res.ok || !res.body) {
            const errorBody = await res.text().catch(() => "");
            console.error(`❌ [AnytypeClient SSE HTTP ${res.status}] ${res.statusText} - Body: ${errorBody}`);
            throw new Error(
              `[AnytypeClient SSE ${res.status}] Failed to connect: ${errorBody || res.statusText}`
            );
          }

          console.log(`✅ [AnytypeClient SSE] Stream established with status ${res.status}`);

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          const queue: { event?: string; data: any }[] = [];

          const parser = createParser({
            onEvent(event) {
              if (!event.data) return;
              let parsedData: any;
              try {
                parsedData = JSON.parse(event.data);
              } catch {
                parsedData = event.data;
              }
              queue.push({
                event: event.event,
                data: parsedData,
              });
            },
          });

          try {
            while (!abortController.signal.aborted) {
              const { done, value } = await reader.read();
              if (done) {
                console.log(`🏁 [AnytypeClient SSE] Stream reached EOF`);
                break;
              }

              const decodedText = decoder.decode(value, { stream: true });
              parser.feed(decodedText);
              while (queue.length > 0) {
                yield queue.shift()!;
              }
            }
          } finally {
            reader.releaseLock();
            console.log(`🔒 [AnytypeClient SSE] Reader lock released for ${chatId}`);
          }
        })()
      );

      return stream$.pipe(
        finalize(() => {
          console.log(`🛑 [AnytypeClient SSE] Finalizing and aborting connection for ${chatId}`);
          abortController.abort();
        })
      );
    });
  }

  // --- Types ---

  async getTypes(spaceId: string): Promise<AnytypeType[]> {
    const res = await this.request(
      TypesResponse,
      `/v1/spaces/${encodeURIComponent(spaceId)}/types`
    );
    return res.data;
  }

  async createType(payload: CreateTypeRequest): Promise<AnytypeType> {
    const res = await this.request(
      TypeResponse,
      `/v1/spaces/${encodeURIComponent(payload.space_id)}/types`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
    return res.type;
  }

  // --- Objects & Search ---

  async searchSpace(spaceId: string, payload: SearchRequest = {}): Promise<AnytypeObject[]> {
    const res = await this.request(
      ObjectsResponse,
      `/v1/spaces/${encodeURIComponent(spaceId)}/search`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
    return res.data;
  }

  async getObject(spaceId: string, objectId: string, format = "md"): Promise<ObjectWithBody> {
    const res = await this.request(
      ObjectResponse,
      `/v1/spaces/${encodeURIComponent(spaceId)}/objects/${encodeURIComponent(objectId)}?format=${format}`
    );
    return res.object;
  }
}
