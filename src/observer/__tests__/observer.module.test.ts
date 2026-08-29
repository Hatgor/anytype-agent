import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { of } from "rxjs";
import { validateConfig } from "../../app.config";
import { HostModelService } from "../../llm/host.model";
import { LlmResponse } from "../../llm/types";
import { ObserverModule } from "../observer.module";
import { ObserverService } from "../observer.service";
import {
  callCount,
  extractChatId,
  extractSpaceId,
  makeMessage,
  type ObserverServiceInternals,
  sleep,
  waitFor,
} from "./helpers";

describe("ObserverModule (Integration Tests via Nest Test)", () => {
  const originalEnv = { ...process.env };
  let testingModule: TestingModule;
  let observerService: ObserverService;
  let internals: ObserverServiceInternals;

  let initSpy: ReturnType<typeof spyOn>;
  let runSpy: ReturnType<typeof spyOn>;
  let fetchSpy: ReturnType<typeof spyOn>;

  // Изменяемое состояние для роутинга фейкового Anytype API
  let spacesList: Array<{ id: string; name: string }> = [];
  let membersMap: Record<string, unknown[]> = {};
  let chatsMap: Record<string, Array<{ id: string; name: string }>> = {};
  let chatsStatus = 200;

  const postMessageCalls: Array<{ space_id: string; chat_id: string; text?: string }> = [];
  const sseControllers: ReadableStreamDefaultController<Uint8Array>[] = [];
  const encoder = new TextEncoder();

  const pushSseEvent = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    eventType: string,
    payload: unknown,
  ) => {
    const chunk = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
    controller.enqueue(encoder.encode(chunk));
  };

  beforeAll(async () => {
    process.env.ANYTYPE_API_URL = "http://127.0.0.1:31012";
    process.env.ANYTYPE_BOT_NAME = "TestBot";
    process.env.ANYTYPE_API_KEY = "secret_key_123";
    process.env.LLM_MODE = "host";
    process.env.HOST_SSH_USER = "testuser";
    process.env.HOST_SSH_KEY_PATH = "/keys/id_ed25519";
    process.env.HOST_CLI_BIN = "claude";
    process.env.OBSERVER_DEBOUNCE_MS = "10";
    process.env.OBSERVER_RETRY_DELAY_MS = "10";
    process.env.OBSERVER_SCAN_INTERVAL_MS = "200";

    // Мокаем вызовы LLM до compile(), чтобы не стрелять в реальный SSH/CLI
    initSpy = spyOn(HostModelService.prototype, "init").mockResolvedValue();
    runSpy = spyOn(HostModelService.prototype, "run").mockImplementation(() =>
      of(LlmResponse.create("  Bot reply  ")),
    );

    // Начальные ответы Anytype API
    spacesList = [
      { id: "sp_main", name: "Main Space" },
      { id: "sp_viewer", name: "Viewer Space" },
      { id: "sp_empty", name: "" },
    ];

    membersMap = {
      sp_main: [
        { id: "mem_1", identity: "TestBot", name: "TestBot", role: "editor", status: "active" },
      ],
      sp_viewer: [
        { id: "mem_2", identity: "TestBot", name: "TestBot", role: "viewer", status: "active" },
      ],
      sp_empty: [
        { id: "mem_3", identity: "TestBot", name: "TestBot", role: "editor", status: "active" },
      ],
    };

    chatsMap = {
      sp_main: [{ id: "chat_main", name: "Chat with TestBot" }],
    };

    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.includes("/messages/stream")) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            sseControllers.push(controller);
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }

      if (url.endsWith("/messages") && method === "POST") {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
        const spaceId = extractSpaceId(url);
        const chatId = extractChatId(url);
        postMessageCalls.push({
          space_id: spaceId,
          chat_id: chatId,
          text: (body as { text: string })?.text,
        });
        return new Response(JSON.stringify({ message_id: "m_1" }), { status: 200 });
      }

      if (url.includes("/chats") && method === "GET") {
        if (chatsStatus !== 200) {
          return new Response(JSON.stringify({ error: "Server Error" }), { status: chatsStatus });
        }
        const spaceId = extractSpaceId(url);
        const chats = chatsMap[spaceId] ?? [];
        return new Response(JSON.stringify({ data: chats }), { status: 200 });
      }

      if (url.includes("/members") && method === "GET") {
        const spaceId = extractSpaceId(url);
        const members = membersMap[spaceId] ?? [];
        return new Response(JSON.stringify({ data: members }), { status: 200 });
      }

      if (url.endsWith("/spaces") && method === "GET") {
        return new Response(JSON.stringify({ data: spacesList }), { status: 200 });
      }

      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as unknown as typeof fetch);

    testingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          validate: validateConfig,
        }),
        ObserverModule,
      ],
    }).compile();

    await testingModule.init();
    observerService = testingModule.get(ObserverService);
    internals = observerService as unknown as ObserverServiceInternals;
  });

  afterAll(async () => {
    await testingModule?.close();
    fetchSpy?.mockRestore();
    initSpy?.mockRestore();
    runSpy?.mockRestore();
    process.env = originalEnv;
  });

  it("1. Спейс с ботом-editor: в registry появился обсервер", async () => {
    await waitFor(() => internals.registry.has("sp_main"));
    expect(internals.registry.has("sp_main")).toBe(true);
  });

  it("2. Viewer-спейс и безымянный спейс: не появились в registry", async () => {
    expect(internals.registry.has("sp_viewer")).toBe(false);
    expect(internals.registry.has("sp_empty")).toBe(false);
  });

  it("3. Полный цикл: enqueue user message_added -> LLM вызвана, POST /messages отправлен с 'Bot reply', lastActivity обновлена", async () => {
    // Ждём инициализацию SSE стрима для sp_main
    await waitFor(() => sseControllers.length >= 1);
    const controller = sseControllers[sseControllers.length - 1];
    if (!controller) throw new Error("SSE controller not found");

    const initialLlmCalls = callCount(runSpy);

    // 1. Стартовый бэкфилл (skip 1)
    pushSseEvent(controller, "message_added", {
      type: "message_added",
      payload: { message: makeMessage({ creator_name: "Alice", id: "init_msg" }) },
    });
    await sleep(40);

    // 2. Реальное пользовательское сообщение
    pushSseEvent(controller, "message_added", {
      type: "message_added",
      payload: { message: makeMessage({ creator_name: "Alice", id: "real_msg" }) },
    });

    // Ждём вызов LLM
    await waitFor(() => callCount(runSpy) === initialLlmCalls + 1);

    // Ждём отправку сообщения в чат Anytype
    await waitFor(() => postMessageCalls.length >= 1);
    const lastPost = postMessageCalls[postMessageCalls.length - 1];
    if (!lastPost) throw new Error("No POST call recorded");
    expect(lastPost.text).toBe("Bot reply");
    expect(lastPost.chat_id).toBe("chat_main");
    expect(lastPost.space_id).toBe("sp_main");

    // lastActivity зафиксирована
    expect(internals.lastActivity.has("sp_main")).toBe(true);
    expect(typeof internals.lastActivity.get("sp_main")).toBe("number");
  });

  it("4. Анти-эхо: enqueue message_added от TestBot -> run не вызывается", async () => {
    const controller = sseControllers[sseControllers.length - 1];
    if (!controller) throw new Error("SSE controller not found");
    const initialLlmCalls = callCount(runSpy);

    pushSseEvent(controller, "message_added", {
      type: "message_added",
      payload: { message: makeMessage({ creator_name: "TestBot" }) },
    });
    pushSseEvent(controller, "message_added", {
      type: "message_added",
      payload: { message: makeMessage({ creator_name: "testbot" }) },
    });

    await sleep(50);
    expect(callCount(runSpy)).toBe(initialLlmCalls);
  });

  it("5. Фатал и восстановление: GET /chats 500 -> registry очищен; возвращаем 200 -> следующий scan пересоздаёт обсервер", async () => {
    expect(internals.registry.has("sp_main")).toBe(true);

    // 1. Ломаем /chats
    chatsStatus = 500;
    // Ошибаем текущий SSE поток, чтобы вызвать реконнект / пересоздание
    const ctrl = sseControllers[sseControllers.length - 1];
    if (ctrl) {
      try {
        ctrl.error(new Error("SSE dropped"));
      } catch {}
    }

    // Удаляем из registry спейс и заставляем скан попытаться создать его при сломанном /chats
    internals.registry.get("sp_main")?.forEach((obs) => {
      obs.destroy();
    });
    internals.registry.delete("sp_main");

    // Сканы каждые 200мс пытаются создать, но /chats 500 -> getOrCreateChat падает -> handleObserverDeath -> registry пуст
    await sleep(250);
    expect(internals.registry.has("sp_main")).toBe(false);

    // 2. Чиним /chats
    chatsStatus = 200;

    // В течение следующего интервала скана (200мс) обсервер успешно пересоздастся
    await waitFor(() => internals.registry.has("sp_main"), 2500);
    expect(internals.registry.has("sp_main")).toBe(true);
  });

  it("6. Пропавший спейс: /v1/spaces пуст -> registry пуст", async () => {
    expect(internals.registry.has("sp_main")).toBe(true);

    // Очищаем список спейсов
    spacesList = [];

    // Ждём скан (200ms)
    await waitFor(() => !internals.registry.has("sp_main"));
    expect(internals.registry.has("sp_main")).toBe(false);
  });
});
