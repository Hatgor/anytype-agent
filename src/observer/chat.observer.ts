import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  catchError,
  concatMap,
  debounceTime,
  defer,
  EMPTY,
  exhaustMap,
  filter,
  from,
  map,
  type Observable,
  of,
  retry,
  scan,
  switchMap,
  takeUntil,
  timeout,
} from "rxjs";
import type { AppConfig } from "../app.config";
import { AnytypeService, type Chat } from "../client";
import type { ChatEvent, ChatMessageAdded, ChatMessagePayload } from "../client/types";
import { LLM_SERVICE } from "../llm/llm.module";
import { AbstractLlmService, LlmAction, type LlmEvent, LlmResponse } from "../llm/types";
import { AbstractObserver, type ObserverFactory } from "./types";

const INITIAL_PROGRESS_TEXT = "⏳ Working...";

// Progress in italics (to separate "bot is working" from content); grey is unavailable — spec does not support color/font.
const progressMarks = (text: string) => [{ type: "italic", from: 0, to: text.length }];

// Canary timeout+retry — insurance against hung HTTP; intentionally not in config (not a tuning knob).
const PROGRESS_POST_TIMEOUT_MS = 5_000;
const PROGRESS_RETRY_DELAY_MS = 1_000;
const SAFE_HTTP_TIMEOUT_MS = 15_000;

@Injectable()
export class ChatObserverFactory implements ObserverFactory {
  constructor(
    private readonly anytype: AnytypeService,
    @Inject(LLM_SERVICE) private readonly llm: AbstractLlmService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  create(spaceId: string, botName: string, botMemberId: string): ChatObserver {
    return new ChatObserver(
      spaceId,
      botName,
      botMemberId,
      this.anytype,
      this.llm,
      this.config.get("OBSERVER_DEBOUNCE_MS"),
      this.config.get("OBSERVER_RETRY_DELAY_MS"),
    );
  }
}

export class ChatObserver extends AbstractObserver {
  private readonly MAX_HISTORY = 50;
  private readonly history = new Map<string, ChatMessagePayload>();

  constructor(
    private readonly spaceId: string,
    private readonly botName: string,
    private readonly botMemberId: string,
    private readonly anytype: AnytypeService,
    private readonly llm: AbstractLlmService,
    private readonly debounceMs: number,
    private readonly retryDelayMs: number,
  ) {
    super();
  }

  run(): Observable<unknown> {
    return this.getOrCreateChat().pipe(
      switchMap((chat) => this.subscribeToChat(chat.id)),
      takeUntil(this.destroy$),
    );
  }

  private getOrCreateChat(): Observable<Chat> {
    return from(this.anytype.getChats(this.spaceId)).pipe(
      map((chats) =>
        chats.find(
          (c) =>
            c.name?.toLowerCase() === `chat with ${this.botName}`.toLowerCase() ||
            c.name?.toLowerCase() === this.botName.toLowerCase() ||
            c.name?.toLowerCase().includes(this.botName.toLowerCase()),
        ),
      ),
      switchMap((chat) =>
        chat
          ? of(chat)
          : this.anytype.createChat(this.spaceId, {
              name: this.botName,
            }),
      ),
    );
  }

  private subscribeToChat(chatId: string): Observable<unknown> {
    // Backfill (replay of ~50 messages on startup/reconnect) is merged via debounce into a SINGLE
    // emission — the chat tail. An unanswered mention/reply to the bot -> reply ("unread");
    // no infinite loop: after replying, the bot's message becomes the tail, and isSelf filters it out.

    return this.anytype.subscribeChatMessages(this.spaceId, chatId).pipe(
      filter((msg) => msg !== null),
      map((msg) => this.handleHistory(msg)),

      // tap(async (event) => {
      //   await (await import("node:fs/promises")).writeFile(
      //     `./src/event-${event.id}.log`,
      //     JSON.stringify(event, null, 2),
      //   );

      //   return event;
      // }),

      // Debounce BEFORE trigger filter: only the TAIL of the window matters (no skip(1)/freshness filter):
      // connect -> pending mention (mention from the middle of replay won't trigger — restarts won't spam);
      // live burst -> users had time to agree, trailing "stop" cancels.
      debounceTime(this.debounceMs),

      // Anti-echo by participant-ID (creator_name sometimes has junk spaces);
      // edits/deletions/reactions do not trigger.
      filter(
        (msg) =>
          msg.type === "message_added" &&
          !this.isBotId(msg.creator) &&
          (this.mentionsBot(msg) || this.repliesToBot(msg)),
      ),

      map(() => ({
        spaceId: this.spaceId,
        payload: Array.from(this.history.values()),
      })),

      // exhaustMap: concurrent runs are forbidden — triggers during generation are dropped, not queued.
      exhaustMap(({ spaceId, payload }) => {
        this.logger.log(`💬 Generating LLM response for chat ${chatId}...`);

        return this.createProgressMessage$(chatId).pipe(
          switchMap((progressId) => this.processLlmRun$(spaceId, chatId, payload, progressId)),
          catchError((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`❌ LLM run dropped: ${msg}`);
            return EMPTY;
          }),
        );
      }),

      // SSE disconnection -> retry recreates the entire chain, including getOrCreateChat.
      retry({ delay: this.retryDelayMs }),
    );
  }

  /**
   * Wire format of participant-ID (proof: spike 2026-08-30 + GET /members):
   * "_participant_<spaceId with dot→underscore>_<identity>" — identity without '_',
   * hence suffix matching instead of exact equality.
   */
  private readonly isBotId = (wire: string | undefined): boolean =>
    Boolean(wire?.endsWith(`_${this.botMemberId}`));

  private readonly mentionsBot = (msg: ChatMessageAdded): boolean =>
    Boolean(msg.content.marks?.some((m) => m.type === "mention" && this.isBotId(m.param)));

  // Reply to a message older than the history window (50) does not trigger — conservative limit.
  private readonly repliesToBot = (msg: ChatMessageAdded): boolean => {
    if (!msg.reply_to_message_id) return false;
    const replied = this.history.get(msg.reply_to_message_id);
    return Boolean(replied && this.isBotId(replied.creator));
  };

  /**
   * Canary: timeout+retry(count:1). Fatal error (after retry) goes into catchError
   * of exhaustMap — LLM is not even called, aliases do not leak.
   */
  private createProgressMessage$(chatId: string): Observable<string> {
    return defer(() =>
      this.anytype.addChatMessage(this.spaceId, chatId, {
        text: INITIAL_PROGRESS_TEXT,
        marks: progressMarks(INITIAL_PROGRESS_TEXT),
      }),
    ).pipe(
      timeout(PROGRESS_POST_TIMEOUT_MS),
      retry({ count: 1, delay: PROGRESS_RETRY_DELAY_MS }),
      map((res) => res.message_id),
    );
  }

  // TODO: delete ProgressMessage after LlmResponse; fallback to ⚠️ on run error/timeout
  /**
   * scan accumulates traces directly inside LlmAction; LlmResponse passes through scan unchanged.
   * concatMap — strict FIFO of network calls without race conditions.
   */
  private processLlmRun$(
    spaceId: string,
    chatId: string,
    payload: ChatMessagePayload[],
    progressId: string,
  ): Observable<unknown> {
    return this.llm.run(spaceId, payload).pipe(
      scan<LlmEvent, LlmEvent>((acc, event) => {
        if (event instanceof LlmResponse) return event;

        const prevText = acc instanceof LlmAction ? acc.detail : INITIAL_PROGRESS_TEXT;
        return LlmAction.create(`${prevText}\n${event.detail}`);
      }, LlmAction.create(INITIAL_PROGRESS_TEXT)),
      concatMap((event) => {
        if (event instanceof LlmAction) {
          return this.safe$(() =>
            this.anytype.editChatMessage(this.spaceId, chatId, progressId, {
              text: event.detail,
              marks: progressMarks(event.detail),
            }),
          );
        }

        const trimmed = event.text.trim();
        return trimmed
          ? this.safe$(() => this.anytype.addChatMessage(this.spaceId, chatId, { text: trimmed }))
          : EMPTY;
      }),
    );
  }

  /**
   * safe$: single failed/hanging POST/PATCH is suppressed (EMPTY), keeping the job stream alive.
   * Canary (progress creation) bypasses safe$ — its failure drops the whole run.
   */
  private safe$(op: () => Promise<unknown>): Observable<unknown> {
    return defer(op).pipe(
      timeout(SAFE_HTTP_TIMEOUT_MS),
      catchError((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`❌ Failed to post/edit chat message: ${msg}`);
        return EMPTY;
      }),
    );
  }

  private readonly handleHistory = (msg: ChatEvent) => {
    switch (msg.type) {
      case "message_added":
        this.history.set(msg.id, msg);

        if (this.history.size > this.MAX_HISTORY) {
          const oldestKey = this.history.keys().next().value;
          if (oldestKey) this.history.delete(oldestKey);
        }

        return msg;
      case "message_updated":
        this.history.set(msg.id, msg);
        return msg;
      case "message_deleted":
        this.history.delete(msg.id);
        return msg;
      case "reactions_updated": {
        const prev = this.history.get(msg.id);
        if (!prev) return msg;

        this.history.set(prev.id, { ...prev, reactions: msg.reactions });
        return msg;
      }
      default:
        return msg;
    }
  };
}
