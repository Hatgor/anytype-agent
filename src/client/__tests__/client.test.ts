import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { Logger } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { firstValueFrom } from "rxjs";
import { Type } from "typebox";
import { validateConfig } from "../../app.config";
import { ANYTYPE_CLIENT, AnytypeClient, AnytypeService, ClientModule } from "../index";

describe("Anytype Client & Service Layer (Separation of Concerns)", () => {
  const testLogger = new Logger("TestAnytypeClient");
  const createTestClient = (
    baseUrl = "http://127.0.0.1:31012",
    apiKey = "secret-token-xyz",
    apiVersion = "2025-11-08",
  ) => new AnytypeClient(testLogger, baseUrl, apiKey, apiVersion);

  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe("AnytypeClient (Low-Level Transport)", () => {
    it("normalizes baseUrl and sends standard HTTP headers", async () => {
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = createTestClient();
      expect(client.baseUrl).toBe("http://127.0.0.1:31012");

      const res = await client.get(Type.Object({ status: Type.String() }), "/ping");
      expect(res.status).toBe("ok");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://127.0.0.1:31012/ping");
      expect(init.headers).toEqual({
        "Content-Type": "application/json",
        "Anytype-Version": "2025-11-08",
        Authorization: "Bearer secret-token-xyz",
      });
    });

    it("stream: connects to SSE stream and emits raw parsed events", async () => {
      const ssePayload =
        'event: message_added\ndata: {"payload":{"message":{"id":"msg1","text":"hello"}}}\n\n';

      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(ssePayload));
          controller.close();
        },
      });

      fetchSpy.mockResolvedValue(
        new Response(mockStream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      );

      const client = createTestClient();
      const stream$ = client.stream("/v1/events/stream");

      const event = await firstValueFrom(stream$);

      expect(event.event).toBe("message_added");
      const eventData = event.data as { payload?: { message?: { text?: string } } };
      expect(eventData?.payload?.message?.text).toBe("hello");
    });

    it("checkHealth: succeeds when endpoint responds with 200", async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));

      const client = createTestClient();
      await expect(client.checkHealth("/v1/spaces", 3, 10)).resolves.toBeUndefined();
    });

    it("checkHealth: fails immediately without retries on 401 Unauthorized", async () => {
      fetchSpy.mockResolvedValue(
        new Response("Unauthorized", { status: 401, statusText: "Unauthorized" }),
      );

      const client = createTestClient();
      await expect(client.checkHealth("/v1/spaces", 5, 10)).rejects.toThrow(
        "Authentication failed with status 401",
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1); // No wasteful retries on bad credentials
    });
  });

  describe("AnytypeService (Domain API Facade)", () => {
    it("getSpaces: fetches spaces list through client", async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ id: "space.1", name: "Test Space" }],
          }),
          { status: 200 },
        ),
      );

      const client = createTestClient();
      const service = new AnytypeService(client);

      const spaces = await service.getSpaces();
      expect(spaces).toHaveLength(1);
      expect(spaces[0]?.name).toBe("Test Space");
    });

    it("addChatMessage: sends only message payload to correct chat endpoint", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message_id: "msg_123",
          }),
          { status: 200 },
        ),
      );

      const client = createTestClient();
      const service = new AnytypeService(client);

      const res = await service.addChatMessage({
        space_id: "space_99",
        chat_id: "chat_42",
        text: "Hi from bot",
      });

      expect(res.message_id).toBe("msg_123");
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://127.0.0.1:31012/v1/spaces/space_99/chats/chat_42/messages");
      expect(JSON.parse(init.body as string)).toEqual({
        text: "Hi from bot",
      });
    });
  });

  describe("ClientModule DI with Async Factory Provider", () => {
    it("bootstraps ClientModule, performs healthcheck in useFactory, and provides ANYTYPE_CLIENT & AnytypeService", async () => {
      process.env.ANYTYPE_API_URL = "http://127.0.0.1:31012";
      process.env.ANYTYPE_BOT_NAME = "Bot";
      process.env.ANYTYPE_API_KEY = "token123";
      process.env.HOST_SSH_USER = "testuser";
      process.env.HOST_SSH_KEY_PATH = "/keys/id_ed25519";
      process.env.HOST_CLI_BIN = "claude";

      fetchSpy.mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));

      const app = await NestFactory.createApplicationContext(
        {
          module: class TestAppModule {},
          imports: [
            ConfigModule.forRoot({
              isGlobal: true,
              validate: validateConfig,
            }),
            ClientModule,
          ],
        },
        { logger: false },
      );

      const client = app.get<AnytypeClient>(ANYTYPE_CLIENT);
      const service = app.get(AnytypeService);

      expect(client).toBeInstanceOf(AnytypeClient);
      expect(service).toBeInstanceOf(AnytypeService);
      expect(client.baseUrl).toBe("http://127.0.0.1:31012");

      await app.close();
    });
  });
});
