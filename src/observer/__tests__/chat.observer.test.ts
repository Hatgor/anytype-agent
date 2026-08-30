import "reflect-metadata";
import { describe, expect, it, mock } from "bun:test";
import { defer, type Observable, of, Subject, throwError } from "rxjs";
import type { AnytypeService, Chat } from "../../client";
import type { ChatEvent, ChatMessagePayload } from "../../client/types";
import { type AbstractLlmService, LlmAction, type LlmEvent, LlmResponse } from "../../llm/types";
import { ChatObserver } from "../chat.observer";
import { callArg, callCount, makeMessage, sleep, waitFor } from "./helpers";

describe("ChatObserver (Unit Tests)", () => {
  const setup = (
    options: {
      getChats?: () => Promise<Chat[]>;
      llmHandler?: (spaceId: string, payload: object) => Observable<LlmEvent>;
      debounceMs?: number;
      retryDelayMs?: number;
    } = {},
  ) => {
    let currentSseSubject = new Subject<ChatEvent>();
    const allSseSubjects: Subject<ChatEvent>[] = [currentSseSubject];

    const anytypeFake = {
      getChats: mock(
        options.getChats ?? (async () => [{ id: "chat.1", name: "Chat with TestBot" }] as Chat[]),
      ),
      createChat: mock(async () => ({ id: "chat.created", name: "TestBot" }) as Chat),
      addChatMessage: mock(async (_spaceId: string, _chatId: string, _body: unknown) => ({
        message_id: "m_1",
      })),
      editChatMessage: mock(async () => ({})),
      subscribeChatMessages: mock((_spaceId: string, _chatId: string): Observable<ChatEvent> => {
        return defer(() => {
          const sub = new Subject<ChatEvent>();
          currentSseSubject = sub;
          allSseSubjects.push(sub);
          return sub;
        });
      }),
    } as unknown as AnytypeService;

    const llmFake = {
      init: mock(async () => {}),
      run: mock(options.llmHandler ?? (() => of(LlmResponse.create("  Bot reply  ")))),
    } as unknown as AbstractLlmService;

    const observer = new ChatObserver(
      "space.1",
      "TestBot",
      "member_test_bot",
      anytypeFake,
      llmFake,
      options.debounceMs ?? 10,
      options.retryDelayMs ?? 10,
    );

    const nextEvents: unknown[] = [];
    const errors: unknown[] = [];
    let completed = false;

    const subscription = observer.run().subscribe({
      next: (v) => nextEvents.push(v),
      error: (err) => errors.push(err),
      complete: () => {
        completed = true;
      },
    });

    const pushEvent = (event: ChatEvent) => {
      currentSseSubject.next(event);
    };

    const ready = async () => {
      await waitFor(() => allSseSubjects.length > 1);
    };

    return {
      observer,
      anytypeFake,
      llmFake,
      subscription,
      nextEvents,
      errors,
      getCompleted: () => completed,
      pushEvent,
      getCurrentSubject: () => currentSseSubject,
      ready,
    };
  };

  it("1. Анти-эхо: message_added от бота (creator = participant-ID) -> run не вызывается, даже с self-mention", async () => {
    const { ready, pushEvent, llmFake, nextEvents } = setup();

    await ready();

    // Эхо бота (wire-форма creator)
    pushEvent({
      ...makeMessage({ creator: "_participant_space.1_member_test_bot", creator_name: "TestBot" }),
      type: "message_added",
    });
    pushEvent({
      ...makeMessage(
        { creator: "_participant_space.1_member_test_bot", creator_name: "testbot" },
        { mentionBot: "member_test_bot" },
      ),
      type: "message_added",
    });

    await sleep(50);

    expect(callCount(llmFake.run)).toBe(0);
    expect(nextEvents.length).toBe(0);
  });

  it("2. Не-триггеры: message_updated / message_deleted / reactions_updated от юзера -> LLM не вызывается", async () => {
    const { ready, pushEvent, llmFake, nextEvents } = setup();

    await ready();

    const msg = makeMessage({ creator_name: "Alice" });
    pushEvent({ ...msg, type: "message_updated" });
    pushEvent({ type: "message_deleted", id: msg.id });
    pushEvent({ type: "reactions_updated", id: msg.id, reactions: { "👍": ["usr_1"] } });

    await sleep(50);

    expect(callCount(llmFake.run)).toBe(0);
    expect(nextEvents.length).toBe(0);
  });

  it("3. Бэкфилл-залп: mention в середине, хвост без mention -> НЕ будит; свежий mention -> будит", async () => {
    const { ready, pushEvent, llmFake } = setup();

    await ready();

    // Рестарты не спамят: mention из середины реплея не будит, решает хвост окна
    pushEvent({
      ...makeMessage({ id: "bf_1" }, { mentionBot: "member_test_bot" }),
      type: "message_added",
    });
    pushEvent({ ...makeMessage({ id: "bf_2" }), type: "message_added" });
    pushEvent({ ...makeMessage({ id: "bf_3" }), type: "message_added" });
    await sleep(40);
    expect(callCount(llmFake.run)).toBe(0);

    pushEvent({
      ...makeMessage({ id: "msg_2" }, { mentionBot: "member_test_bot" }),
      type: "message_added",
    });
    await waitFor(() => callCount(llmFake.run) === 1);

    expect(callCount(llmFake.run)).toBe(1);
  });

  it("4. Дебаунс: 2-3 сообщения подряд в пределах окна -> ОДИН вызов run с накопленной историей", async () => {
    const { ready, pushEvent, llmFake } = setup({ debounceMs: 30 });

    await ready();

    // Прогрев: залп без mention — не триггер, наполняет history
    pushEvent({
      ...makeMessage({ creator_name: "Alice", id: "msg_init" }, {}),
      type: "message_added",
    });
    await sleep(60);

    const m1 = makeMessage(
      { creator_name: "Alice", id: "m1", content: { text: "Part 1", style: "paragraph" } },
      { mentionBot: "member_test_bot" },
    );
    const m2 = makeMessage(
      { creator_name: "Alice", id: "m2", content: { text: "Part 2", style: "paragraph" } },
      { mentionBot: "member_test_bot" },
    );
    const m3 = makeMessage(
      { creator_name: "Bob", id: "m3", content: { text: "Part 3", style: "paragraph" } },
      { mentionBot: "member_test_bot" },
    );

    pushEvent({ ...m1, type: "message_added" });
    pushEvent({ ...m2, type: "message_added" });
    pushEvent({ ...m3, type: "message_added" });

    await waitFor(() => callCount(llmFake.run) === 1);

    expect(callCount(llmFake.run)).toBe(1);

    const spaceIdArg = callArg<string>(llmFake.run, 0, 0);
    const payloadArg = callArg<ChatMessagePayload[]>(llmFake.run, 0, 1);
    expect(spaceIdArg).toBe("space.1");
    expect(payloadArg.length).toBeGreaterThanOrEqual(3);
    const ids = payloadArg.map((p) => p.id);
    expect(ids).toContain("m1");
    expect(ids).toContain("m2");
    expect(ids).toContain("m3");
  });

  it("5. Heartbeat: на один отправленный ответ ровно один next() в run()", async () => {
    const { ready, pushEvent, nextEvents } = setup();

    await ready();

    pushEvent({
      ...makeMessage({}, {}),
      type: "message_added",
    });
    await sleep(30);

    pushEvent({ ...makeMessage({}, { mentionBot: "member_test_bot" }), type: "message_added" });

    await waitFor(() => nextEvents.length === 1);
    expect(nextEvents.length).toBe(1);
  });

  it("6. Прогресс постится первым, ответ — вторым; трим: '  Bot reply  ' -> 'Bot reply'", async () => {
    const { ready, pushEvent, anytypeFake } = setup({
      llmHandler: () => of(LlmResponse.create("  Bot reply  ")),
    });

    await ready();

    pushEvent({
      ...makeMessage({}, {}),
      type: "message_added",
    });
    await sleep(30);

    pushEvent({ ...makeMessage({}, { mentionBot: "member_test_bot" }), type: "message_added" });

    await waitFor(() => callCount(anytypeFake.addChatMessage) === 2);

    const progressBody = callArg<{ text: string }>(anytypeFake.addChatMessage, 0, 2);
    expect(progressBody.text).toBe("⏳ Working...");

    const spaceId = callArg<string>(anytypeFake.addChatMessage, 1, 0);
    const chatId = callArg<string>(anytypeFake.addChatMessage, 1, 1);
    const addBody = callArg<{ text: string }>(anytypeFake.addChatMessage, 1, 2);
    expect(spaceId).toBe("space.1");
    expect(chatId).toBe("chat.1");
    expect(addBody.text).toBe("Bot reply");
  });

  it("7. Пустой ответ LLM ('' и '   ') -> addChatMessage не вызывался, heartbeat не бился, поток жив", async () => {
    let count = 0;
    const { ready, pushEvent, anytypeFake, nextEvents } = setup({
      llmHandler: () => {
        count++;
        return of(LlmResponse.create(count === 1 ? "   " : "Valid reply"));
      },
    });

    await ready();

    pushEvent({
      ...makeMessage({}, {}),
      type: "message_added",
    });
    await sleep(30);

    pushEvent({ ...makeMessage({}, { mentionBot: "member_test_bot" }), type: "message_added" });
    await sleep(50);

    // Постился только прогресс; heartbeat нет (ответ уходит в EMPTY, стрим жив)
    expect(callCount(anytypeFake.addChatMessage)).toBe(1);
    expect(nextEvents.length).toBe(0);

    pushEvent({ ...makeMessage({}, { mentionBot: "member_test_bot" }), type: "message_added" });
    await waitFor(() => callCount(anytypeFake.addChatMessage) === 3);
    expect(nextEvents.length).toBe(1);
  });

  it("8. LLM кидает ошибку -> addChatMessage не вызывался, heartbeat не бился, поток жив (последующий триггер работает)", async () => {
    let count = 0;
    const { ready, pushEvent, anytypeFake, nextEvents } = setup({
      llmHandler: () => {
        count++;
        if (count === 1) return throwError(() => new Error("LLM boom"));
        return of(LlmResponse.create("Recovered reply"));
      },
    });

    await ready();

    pushEvent({
      ...makeMessage({}, {}),
      type: "message_added",
    });
    await sleep(30);

    pushEvent({ ...makeMessage({}, { mentionBot: "member_test_bot" }), type: "message_added" });
    await sleep(50);

    // Постился только прогресс; heartbeat нет (ответ уходит в EMPTY, стрим жив)
    expect(callCount(anytypeFake.addChatMessage)).toBe(1);
    expect(nextEvents.length).toBe(0);

    pushEvent({ ...makeMessage({}, { mentionBot: "member_test_bot" }), type: "message_added" });
    await waitFor(() => callCount(anytypeFake.addChatMessage) === 3);
    expect(nextEvents.length).toBe(1);
  });

  it("9. Упавший пост ответа не роняет стрим: прогресс прошёл, ответ исчез, следующий триггер доставляет ответ", async () => {
    const { ready, pushEvent, anytypeFake, nextEvents } = setup();

    let responseFailures = 0;
    (anytypeFake.addChatMessage as ReturnType<typeof mock>).mockImplementation(
      async (_spaceId: string, _chatId: string, body: { text: string }) => {
        // Прогресс-посты проходят, первый ответный — падает
        if (!body.text.startsWith("⏳")) {
          responseFailures++;
          if (responseFailures === 1) throw new Error("API post error");
        }
        return { message_id: "m_ok" };
      },
    );

    await ready();

    pushEvent({
      ...makeMessage({}, {}),
      type: "message_added",
    });
    await sleep(30);

    // Ответный пост упал — safe$ заглушил, heartbeat нет
    pushEvent({ ...makeMessage({}, { mentionBot: "member_test_bot" }), type: "message_added" });
    await sleep(50);
    expect(nextEvents.length).toBe(0);

    pushEvent({ ...makeMessage({}, { mentionBot: "member_test_bot" }), type: "message_added" });
    await waitFor(() => nextEvents.length === 1);
    expect(callCount(anytypeFake.addChatMessage)).toBe(4);
  });

  it("10. Фатал: getChats reject -> run() error'ится", async () => {
    const { errors, subscription } = setup({
      getChats: async () => {
        throw new Error("Network fatal getChats");
      },
    });

    await waitFor(() => errors.length === 1);
    expect((errors[0] as Error).message).toContain("Network fatal getChats");
    expect(subscription.closed).toBe(true);
  });

  it("11. SSE error(): run() НЕ error'ится (retry держит). Реплей бэкфилла после reconnect не будит", async () => {
    const { ready, errors, getCurrentSubject, pushEvent, llmFake } = setup({
      retryDelayMs: 20,
    });

    await ready();

    pushEvent({
      ...makeMessage({}, {}),
      type: "message_added",
    });
    await sleep(30);

    pushEvent({ ...makeMessage({}, { mentionBot: "member_test_bot" }), type: "message_added" });
    await waitFor(() => callCount(llmFake.run) === 1);

    const prevSubject = getCurrentSubject();
    prevSubject.error(new Error("SSE connection dropped"));

    await waitFor(() => getCurrentSubject() !== prevSubject);
    expect(errors.length).toBe(0);

    pushEvent({
      ...makeMessage({}, {}),
      type: "message_added",
    });
    await sleep(40);
    expect(callCount(llmFake.run)).toBe(1);

    pushEvent({ ...makeMessage({}, { mentionBot: "member_test_bot" }), type: "message_added" });
    await waitFor(() => callCount(llmFake.run) === 2);
  });

  it("12. destroy() -> run() complete; события после destroy не будят LLM", async () => {
    const { ready, observer, pushEvent, llmFake, getCompleted } = setup();

    await ready();

    observer.destroy();
    await waitFor(() => getCompleted());
    expect(getCompleted()).toBe(true);

    pushEvent({ ...makeMessage({}, { mentionBot: "member_test_bot" }), type: "message_added" });
    pushEvent({ ...makeMessage({}, { mentionBot: "member_test_bot" }), type: "message_added" });

    await sleep(50);
    expect(callCount(llmFake.run)).toBe(0);
  });

  it("13. LlmAction -> editChatMessage прогресс-сообщения с накопленным текстом, новых сообщений не постит", async () => {
    const { ready, pushEvent, anytypeFake } = setup({
      llmHandler: () =>
        of(
          LlmAction.create("GET /objects → 200"),
          LlmAction.create("POST /files → 201"),
          LlmResponse.create("Done"),
        ),
    });

    await ready();

    pushEvent({
      ...makeMessage({}, {}),
      type: "message_added",
    });
    await sleep(30);

    pushEvent({ ...makeMessage({}, { mentionBot: "member_test_bot" }), type: "message_added" });

    await waitFor(() => callCount(anytypeFake.addChatMessage) === 2);

    // Каждый edit переписывает весь накопленный текст
    expect(callCount(anytypeFake.editChatMessage)).toBe(2);
    const edit1 = callArg<{ text: string }>(anytypeFake.editChatMessage, 0, 3);
    expect(edit1.text).toBe("⏳ Working...\nGET /objects → 200");
    const edit2 = callArg<{ text: string }>(anytypeFake.editChatMessage, 1, 3);
    expect(edit2.text).toBe("⏳ Working...\nGET /objects → 200\nPOST /files → 201");

    const marks = callArg<{ marks: Array<{ type: string; from: number; to: number }> }>(
      anytypeFake.editChatMessage,
      1,
      3,
    ).marks;
    expect(marks).toEqual([{ type: "italic", from: 0, to: edit2.text.length }]);
  });

  it("14. Прогресс не создался после ретрая -> весь ран дропнут, llm.run не вызывался, SSE жив", async () => {
    const { ready, pushEvent, anytypeFake, llmFake, nextEvents, errors } = setup();

    (anytypeFake.addChatMessage as ReturnType<typeof mock>).mockImplementation(async () => {
      throw new Error("progress post failed");
    });

    await ready();

    pushEvent({
      ...makeMessage({}, {}),
      type: "message_added",
    });
    await sleep(30);

    // Обе попытки (исходная + ретрай) падают — ран дропнут
    pushEvent({ ...makeMessage({}, { mentionBot: "member_test_bot" }), type: "message_added" });

    // Ждём дольше PROGRESS_RETRY_DELAY_MS
    await sleep(1600);
    expect(callCount(anytypeFake.addChatMessage)).toBe(2);
    expect(callCount(llmFake.run)).toBe(0);
    expect(nextEvents.length).toBe(0);
    expect(errors.length).toBe(0);

    // SSE жив: следующий триггер дропается так же, без фатала
    pushEvent({ ...makeMessage({}, { mentionBot: "member_test_bot" }), type: "message_added" });
    await sleep(1600);
    expect(callCount(llmFake.run)).toBe(0);
    expect(errors.length).toBe(0);
  });

  it("15. Первая попытка прогресса упала, ретрай удался -> ран выполняется, ответ доставлен", async () => {
    const { ready, pushEvent, anytypeFake, llmFake, nextEvents } = setup({
      llmHandler: () => of(LlmResponse.create("Delivered reply")),
    });

    let progressFailures = 0;
    (anytypeFake.addChatMessage as ReturnType<typeof mock>).mockImplementation(
      async (_spaceId: string, _chatId: string, body: { text: string }) => {
        if (body.text.startsWith("⏳")) {
          progressFailures++;
          if (progressFailures === 1) throw new Error("progress post failed");
        }
        return { message_id: "m_ok" };
      },
    );

    await ready();

    pushEvent({
      ...makeMessage({}, {}),
      type: "message_added",
    });
    await sleep(30);

    pushEvent({ ...makeMessage({}, { mentionBot: "member_test_bot" }), type: "message_added" });

    await waitFor(() => callCount(llmFake.run) === 1, 3000);
    await waitFor(() => callCount(anytypeFake.addChatMessage) === 3, 3000);

    const response = callArg<{ text: string }>(anytypeFake.addChatMessage, 2, 2);
    expect(response.text).toBe("Delivered reply");
    expect(nextEvents.length).toBe(1);
  });

  it("16. Mention другого человека / сообщение без mention -> не триггер", async () => {
    const { ready, pushEvent, llmFake, nextEvents } = setup();

    await ready();

    pushEvent({
      ...makeMessage({}, {}),
      type: "message_added",
    });
    await sleep(30);

    pushEvent({
      ...makeMessage({ creator_name: "Alice", id: "plain_msg" }),
      type: "message_added",
    });
    pushEvent({
      ...makeMessage({
        creator_name: "Andrii",
        id: "other_mention",
        content: {
          text: "Olena привет",
          style: "paragraph",
          marks: [{ type: "mention", param: "_participant_space_member_other" }],
        },
      }),
      type: "message_added",
    });

    await sleep(50);

    expect(callCount(llmFake.run)).toBe(0);
    expect(nextEvents.length).toBe(0);
  });

  it("17. Reply на сообщение бота -> триггер; reply на сообщение человека -> нет", async () => {
    const { ready, pushEvent, llmFake } = setup();

    await ready();

    pushEvent({
      ...makeMessage({}, {}),
      type: "message_added",
    });
    await sleep(30);

    // Ботовское сообщение в history — creator в wire-форме (суффикс-матч)
    pushEvent({
      ...makeMessage({
        id: "bot_msg",
        creator: "_participant_space.1_member_test_bot",
        creator_name: "TestBot",
      }),
      type: "message_added",
    });
    pushEvent({
      ...makeMessage({ id: "human_msg", creator_name: "Alice" }),
      type: "message_added",
    });
    await sleep(30);

    pushEvent({
      ...makeMessage({ creator_name: "Alice", id: "reply_human" }, { replyTo: "human_msg" }),
      type: "message_added",
    });
    await sleep(50);
    expect(callCount(llmFake.run)).toBe(0);

    pushEvent({
      ...makeMessage({ creator_name: "Alice", id: "reply_bot" }, { replyTo: "bot_msg" }),
      type: "message_added",
    });
    await waitFor(() => callCount(llmFake.run) === 1);
  });

  it("18. Бэкфилл-залп с mention в ХВОСТЕ -> бот отвечает (pending mention)", async () => {
    const { ready, pushEvent, llmFake } = setup();

    await ready();

    pushEvent({ ...makeMessage({ id: "bf_1" }), type: "message_added" });
    pushEvent({ ...makeMessage({ id: "bf_2" }), type: "message_added" });
    pushEvent({
      ...makeMessage({ id: "bf_3" }, { mentionBot: "member_test_bot" }),
      type: "message_added",
    });

    await waitFor(() => callCount(llmFake.run) === 1);
  });
});
