import "reflect-metadata";
import { describe, expect, it, mock } from "bun:test";
import { type ConfigService } from "@nestjs/config";
import { defer, Observable, of, Subject } from "rxjs";
import type { AppConfig } from "../../app.config";
import type { AnytypeService, Chat } from "../../client";
import type { ChatEvent, ChatMessage } from "../../client/types";
import { type AbstractLlmService, LlmAction, type LlmEvent, LlmResponse } from "../../llm/types";
import { ChatsObserver, ChatsObserverFactory } from "../chats.observer";
import { callArg, callCount, makeMessage, sleep, waitFor } from "./helpers";

describe("ChatsObserver (Unit Tests)", () => {
  const setup = (
    options: {
      getChats?: () => Promise<Chat[]>;
      getChatMessages?: (spaceId: string, chatId: string) => Promise<ChatMessage[]>;
      getChatMessage?: (spaceId: string, chatId: string, messageId: string) => Promise<ChatMessage>;
      llmHandler?: (spaceId: string, payload: object, abort: AbortSignal) => Observable<LlmEvent>;
      scanIntervalMs?: number;
    } = {},
  ) => {
    const sseSubjects = new Map<string, Subject<ChatEvent>>();

    const anytypeFake = {
      getChats: mock(
        options.getChats ??
          (async () =>
            [
              { id: "chat.1", name: "Chat 1" },
              { id: "chat.2", name: "Chat 2" },
            ] as Chat[]),
      ),
      getChatMessages: mock(options.getChatMessages ?? (async () => [] as ChatMessage[])),
      getChatMessage: mock(
        options.getChatMessage ??
          (async (_spaceId: string, _chatId: string, messageId: string) =>
            makeMessage({
              id: messageId,
              creator: "_participant_space.1_member_test_bot",
            }) as unknown as ChatMessage),
      ),
      addChatMessage: mock(async (_spaceId: string, _chatId: string, _body: unknown) => ({
        message_id: `prog_${Date.now()}_${Math.random()}`,
      })),
      editChatMessage: mock(async () => ({})),
      deleteChatMessage: mock(async () => ({})),
      subscribeChatMessages: mock((_spaceId: string, chatId: string): Observable<ChatEvent> => {
        return defer(() => {
          let sub = sseSubjects.get(chatId);
          if (!sub) {
            sub = new Subject<ChatEvent>();
            sseSubjects.set(chatId, sub);
          }
          return sub;
        });
      }),
    } as unknown as AnytypeService;

    const llmFake = {
      init: mock(async () => {}),
      run: mock(options.llmHandler ?? (() => of(LlmResponse.create("  Bot reply  ")))),
    } as unknown as AbstractLlmService;

    const configMock = {
      get: (key: string) => {
        if (key === "OBSERVER_SCAN_INTERVAL_MS") return options.scanIntervalMs ?? 60_000;
        if (key === "OBSERVER_RETRY_DELAY_MS") return 10;
        if (key === "OBSERVER_DEBOUNCE_MS") return 10;
        return undefined;
      },
    } as unknown as ConfigService<AppConfig, true>;

    const observer = new ChatsObserver(
      "space.1",
      "member_test_bot",
      anytypeFake,
      llmFake,
      configMock,
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

    const pushEvent = (chatId: string, event: ChatEvent) => {
      let sub = sseSubjects.get(chatId);
      if (!sub) {
        sub = new Subject<ChatEvent>();
        sseSubjects.set(chatId, sub);
      }
      sub.next(event);
    };

    const ready = async () => {
      await waitFor(() => sseSubjects.size >= 1);
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
      getSseSubject: (chatId: string) => sseSubjects.get(chatId),
      ready,
    };
  };

  it("1. Discovery: subscribes to SSE for all discovered chats", async () => {
    const { ready, anytypeFake } = setup();

    await ready();

    expect(callCount(anytypeFake.getChats)).toBe(1);
    expect(callCount(anytypeFake.subscribeChatMessages)).toBe(2);
  });

  it("2. Anti-echo: message_added from bot (creator suffix) -> LLM is not called", async () => {
    const { ready, pushEvent, llmFake } = setup();

    await ready();

    pushEvent("chat.1", {
      ...makeMessage({ creator: "_participant_space.1_member_test_bot", creator_name: "TestBot" }),
      type: "message_added",
    });

    await sleep(40);
    expect(callCount(llmFake.run)).toBe(0);
  });

  it("3. Direct Mention: message_added mentioning bot -> creates progress, runs LLM, posts reply, deletes progress", async () => {
    const { ready, pushEvent, anytypeFake, llmFake } = setup();

    await ready();

    pushEvent("chat.1", {
      ...makeMessage({ id: "msg_user", creator: "user_42" }, { mentionBot: "member_test_bot" }),
      type: "message_added",
    });

    await waitFor(() => callCount(llmFake.run) === 1);

    expect(callCount(anytypeFake.addChatMessage)).toBe(2); // 1: Progress, 2: Final response
    expect(callCount(anytypeFake.getChatMessages)).toBe(1); // Fetch history
    expect(callCount(anytypeFake.deleteChatMessage)).toBe(1); // Teardown progress

    const progressPost = callArg<{ text: string; reply_to_message_id?: string }>(
      anytypeFake.addChatMessage,
      0,
      2,
    );
    expect(progressPost.reply_to_message_id).toBe("msg_user");

    const finalPost = callArg<{ text: string; reply_to_message_id?: string }>(
      anytypeFake.addChatMessage,
      1,
      2,
    );
    expect(finalPost.text).toBe("Bot reply");
    expect(finalPost.reply_to_message_id).toBe("msg_user");
  });

  it("4. Reply to Bot: message replying to bot -> checks parent with getChatMessage and triggers LLM", async () => {
    const { ready, pushEvent, anytypeFake, llmFake } = setup();

    await ready();

    pushEvent("chat.1", {
      ...makeMessage({
        id: "msg_reply",
        creator: "user_42",
        reply_to_message_id: "msg_parent",
      }),
      type: "message_added",
    });

    await waitFor(() => callCount(llmFake.run) === 1);

    expect(callCount(anytypeFake.getChatMessage)).toBe(1);
    expect(callCount(llmFake.run)).toBe(1);
  });

  it("5. Reply to other user: message replying to non-bot -> getChatMessage returns other user -> LLM is NOT called", async () => {
    const { ready, pushEvent, anytypeFake, llmFake } = setup({
      getChatMessage: async () =>
        makeMessage({
          id: "msg_parent",
          creator: "_participant_space.1_user_other",
        }) as unknown as ChatMessage,
    });

    await ready();

    pushEvent("chat.1", {
      ...makeMessage({
        id: "msg_reply",
        creator: "user_42",
        reply_to_message_id: "msg_parent",
      }),
      type: "message_added",
    });

    await sleep(50);

    expect(callCount(anytypeFake.getChatMessage)).toBe(1);
    expect(callCount(llmFake.run)).toBe(0);
  });

  it("6. Preemption: new mention in same chat cancels in-flight LLM via abort signal", async () => {
    let abortSignal1: AbortSignal | undefined;
    let abortSignal2: AbortSignal | undefined;

    const { ready, pushEvent, llmFake } = setup({
      llmHandler: (_spaceId, _payload, abort) => {
        if (!abortSignal1) {
          abortSignal1 = abort;
          return new Observable<LlmEvent>((subscriber) => {
            const timer = setTimeout(() => {
              subscriber.next(LlmResponse.create("First reply"));
              subscriber.complete();
            }, 500);
            return () => clearTimeout(timer);
          });
        }
        abortSignal2 = abort;
        return of(LlmResponse.create("Second reply"));
      },
    });

    await ready();

    // First trigger
    pushEvent("chat.1", {
      ...makeMessage({ id: "msg_1" }, { mentionBot: "member_test_bot" }),
      type: "message_added",
    });

    await waitFor(() => Boolean(abortSignal1));
    expect(abortSignal1?.aborted).toBe(false);

    // Second trigger in same chat (preempts first)
    pushEvent("chat.1", {
      ...makeMessage({ id: "msg_2" }, { mentionBot: "member_test_bot" }),
      type: "message_added",
    });

    await waitFor(() => Boolean(abortSignal2));

    expect(abortSignal1?.aborted).toBe(true);
    expect(callCount(llmFake.run)).toBe(2);
  });

  it("7. LlmAction Streaming: intermediate actions edit progress message with italic marks", async () => {
    const { ready, pushEvent, anytypeFake } = setup({
      llmHandler: () =>
        of(
          LlmAction.create("Tool 1 called"),
          LlmAction.create("Tool 2 called"),
          LlmResponse.create("Final output"),
        ),
    });

    await ready();

    pushEvent("chat.1", {
      ...makeMessage({ id: "msg_stream" }, { mentionBot: "member_test_bot" }),
      type: "message_added",
    });

    await waitFor(() => callCount(anytypeFake.editChatMessage) === 2);

    expect(callCount(anytypeFake.editChatMessage)).toBe(2);
    const firstEdit = callArg<{ text: string; marks: { type: string }[] }>(
      anytypeFake.editChatMessage,
      0,
      3,
    );
    expect(firstEdit.text).toContain("Tool 1 called");
    expect(firstEdit.marks[0]?.type).toBe("italic");
  });

  it("8. ChatsObserverFactory: creates instance implementing ObserverFactory", () => {
    const factory = new ChatsObserverFactory(
      {} as AnytypeService,
      {} as AbstractLlmService,
      {} as ConfigService<AppConfig, true>,
    );

    const observer = factory.create("space.1", "TestBot", "member.1");
    expect(observer).toBeInstanceOf(ChatsObserver);
  });

  it("9. Backfill Idempotency: bot reply with reply_to_message_id cancels pending trigger during debounce window", async () => {
    const { ready, pushEvent, llmFake } = setup();

    await ready();

    // 1. Backfill burst: Historical mention from user
    pushEvent("chat.1", {
      ...makeMessage({ id: "hist_1", creator: "user_42" }, { mentionBot: "member_test_bot" }),
      type: "message_added",
    });

    // 2. Immediate anti-trigger: Existing bot response in backfill replying to hist_1
    pushEvent("chat.1", {
      ...makeMessage({
        id: "hist_bot_reply",
        creator: "_participant_space.1_member_test_bot",
        reply_to_message_id: "hist_1",
      }),
      type: "message_added",
    });

    // Wait past debounce window
    await sleep(50);

    // LLM must NOT be called because bot already answered this trigger
    expect(callCount(llmFake.run)).toBe(0);
  });

  it("10. Live Burst: second mention replaces first pending trigger, running LLM only for the latest", async () => {
    const { ready, pushEvent, llmFake } = setup();

    await ready();

    // First mention
    pushEvent("chat.1", {
      ...makeMessage(
        { id: "burst_1", creator: "user_42", content: { text: "first", style: "paragraph" } },
        { mentionBot: "member_test_bot" },
      ),
      type: "message_added",
    });

    // Second mention arrives quickly within debounce window
    pushEvent("chat.1", {
      ...makeMessage(
        { id: "burst_2", creator: "user_42", content: { text: "second", style: "paragraph" } },
        { mentionBot: "member_test_bot" },
      ),
      type: "message_added",
    });

    await waitFor(() => callCount(llmFake.run) === 1);

    expect(callCount(llmFake.run)).toBe(1);
    const payloadArg = callArg<{ msg: { id: string } }>(llmFake.run, 0, 1);
    expect(payloadArg.msg.id).toBe("burst_2");
  });

  it("11. Positive Backfill: unanswered mention in replay burst triggers LLM after debounce window", async () => {
    const { ready, pushEvent, anytypeFake, llmFake } = setup();

    await ready();

    // 1. First mention in replay (already answered by bot)
    pushEvent("chat.1", {
      ...makeMessage(
        { id: "hist_answered", creator: "user_42" },
        { mentionBot: "member_test_bot" },
      ),
      type: "message_added",
    });

    // 2. Bot reply in replay that cancels the first mention
    pushEvent("chat.1", {
      ...makeMessage({
        id: "hist_bot_reply",
        creator: "_participant_space.1_member_test_bot",
        reply_to_message_id: "hist_answered",
      }),
      type: "message_added",
    });

    // 3. Second mention in replay (unanswered offline mention)
    pushEvent("chat.1", {
      ...makeMessage(
        {
          id: "hist_unanswered",
          creator: "user_alice",
          content: { text: "offline question", style: "paragraph" },
        },
        { mentionBot: "member_test_bot" },
      ),
      type: "message_added",
    });

    // 4. Intervening noise in replay (does not cancel unanswered mention)
    pushEvent("chat.1", {
      ...makeMessage({
        id: "hist_noise",
        creator: "user_bob",
        content: { text: "just chatting", style: "paragraph" },
      }),
      type: "message_added",
    });

    // Wait past debounce window
    await waitFor(() => callCount(llmFake.run) === 1);

    expect(callCount(llmFake.run)).toBe(1);
    const payloadArg = callArg<{ msg: { id: string } }>(llmFake.run, 0, 1);
    expect(payloadArg.msg.id).toBe("hist_unanswered");

    // Check that reply_to_message_id links back to the unanswered question
    const progressPost = callArg<{ text: string; reply_to_message_id?: string }>(
      anytypeFake.addChatMessage,
      0,
      2,
    );
    expect(progressPost.reply_to_message_id).toBe("hist_unanswered");
  });

  it("12. Dynamic Reconciliation: archiving chat unsubscribes SSE, new chat subscribes SSE", async () => {
    let currentChats: Chat[] = [
      { id: "chat.1", name: "Chat 1" } as Chat,
      { id: "chat.2", name: "Chat 2" } as Chat,
    ];

    const { getSseSubject } = setup({
      scanIntervalMs: 25,
      getChats: async () => currentChats,
    });

    await waitFor(
      () => getSseSubject("chat.1") !== undefined && getSseSubject("chat.2") !== undefined,
    );

    const subChat1 = getSseSubject("chat.1");
    const subChat2 = getSseSubject("chat.2");
    expect(subChat1?.observed).toBe(true);
    expect(subChat2?.observed).toBe(true);

    // Archive chat.2, and add chat.3
    currentChats = [
      { id: "chat.1", name: "Chat 1" } as Chat,
      { id: "chat.2", name: "Chat 2", archived: true } as Chat,
      { id: "chat.3", name: "Chat 3" } as Chat,
    ];

    // Wait for scan to reconcile
    await waitFor(() => subChat2?.observed === false);
    await waitFor(() => getSseSubject("chat.3") !== undefined);

    const subChat3 = getSseSubject("chat.3");
    expect(subChat1?.observed).toBe(true);
    expect(subChat2?.observed).toBe(false);
    expect(subChat3?.observed).toBe(true);
  });

  it("13. Self-healing: individual chat software crash revives via retry", async () => {
    let attempts = 0;
    const { ready, pushEvent, llmFake } = setup({
      getChatMessage: async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error("Simulated software error in classifier");
        }
        return makeMessage({
          creator: "_participant_space.1_member_test_bot",
        }) as unknown as ChatMessage;
      },
    });

    await ready();

    // 1. First trigger causes classifier to throw
    pushEvent("chat.1", {
      ...makeMessage({ id: "msg_1", reply_to_message_id: "bot_msg" }),
      type: "message_added",
    });

    // Wait for retry delay (10ms) + buffer
    await sleep(35);

    // 2. Second trigger succeeds on the re-subscribed stream
    pushEvent("chat.1", {
      ...makeMessage({ id: "msg_2", reply_to_message_id: "bot_msg" }),
      type: "message_added",
    });

    await waitFor(() => callCount(llmFake.run) === 1);
    expect(callCount(llmFake.run)).toBe(1);
  });
});
