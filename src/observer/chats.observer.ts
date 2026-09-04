import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  catchError,
  concatMap,
  debounceTime,
  defer,
  distinctUntilChanged,
  EMPTY,
  exhaustMap,
  filter,
  finalize,
  from,
  map,
  mergeMap,
  Observable,
  of,
  retry,
  scan,
  shareReplay,
  switchMap,
  takeUntil,
  tap,
  timeout,
  timer,
} from "rxjs";
import type { AppConfig } from "../app.config";
import { AnytypeService } from "../client/anytype.service";
import type { ChatMessageAdded } from "../client/types";
import { LLM_SERVICE } from "../llm/llm.module";
import { type AbstractLlmService, LlmAction, type LlmEvent, LlmResponse } from "../llm/types";
import { AbstractObserver, type ObserverFactory } from "./types";

@Injectable()
export class ChatsObserverFactory implements ObserverFactory {
  constructor(
    private readonly anytype: AnytypeService,
    @Inject(LLM_SERVICE) private readonly llm: AbstractLlmService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  create(spaceId: string, _botName: string, botMemberId: string): ChatsObserver {
    return new ChatsObserver(spaceId, botMemberId, this.anytype, this.llm, this.config);
  }
}

// TODO; move to class itself
const INITIAL_PROGRESS_TEXT = "⏳ Working...";
const PROGRESS_POST_TIMEOUT_MS = 5_000;
const PROGRESS_RETRY_DELAY_MS = 1_000;
const SAFE_HTTP_TIMEOUT_MS = 15_000;

// Progress in italics (to separate "bot is working" from content); grey is unavailable — spec does not support color/font.
const progressMarks = (text: string) => [{ type: "italic", from: 0, to: text.length }];

type ChatIntent =
  | { type: "trigger"; msg: ChatMessageAdded }
  | { type: "bot_reply"; replyToId?: string }
  | { type: "noop" };

export class ChatsObserver extends AbstractObserver {
  constructor(
    private readonly spaceId: string,
    private readonly botMemberId: string,
    private readonly anytype: AnytypeService,
    private readonly llm: AbstractLlmService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {
    super();
  }

  run(): Observable<unknown> {
    const scanIntervalMs = this.config.get("OBSERVER_SCAN_INTERVAL_MS");

    const activeChatIds$ = timer(0, scanIntervalMs).pipe(
      exhaustMap(() => this.anytype.getChats(this.spaceId)),
      map((chats) => new Set(chats.filter((c) => !c.archived).map((c) => c.id))),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    return activeChatIds$.pipe(
      scan(
        (acc, activeIds) => ({
          added: [...activeIds].filter((id) => !acc.knownIds.has(id)),
          knownIds: activeIds,
        }),
        { added: [] as string[], knownIds: new Set<string>() },
      ),
      mergeMap(({ added }) => from(added)),
      mergeMap((chatId) =>
        this.subscribeToChat(chatId).pipe(
          retry({
            delay: (err) => {
              this.logger.error(`Failed in chat ${chatId}: ${err?.message ?? err}`, err?.stack);
              return timer(this.config.get("OBSERVER_RETRY_DELAY_MS"));
            },
          }),
          takeUntil(activeChatIds$.pipe(filter((activeIds) => !activeIds.has(chatId)))),
        ),
      ),
      takeUntil(this.destroy$),
    );
  }

  private subscribeToChat(chatId: string): Observable<unknown> {
    const debounceMs = this.config.get("OBSERVER_DEBOUNCE_MS");

    const intent$ = this.anytype.subscribeChatMessages(this.spaceId, chatId).pipe(
      retry({ delay: this.config.get("OBSERVER_RETRY_DELAY_MS") }),
      filter((msg) => msg !== null && msg.type === "message_added"),
      concatMap((msg) => this.classifyMessage(chatId, msg)),
      scan((pending: ChatMessageAdded | null, intent: ChatIntent): ChatMessageAdded | null => {
        if (intent.type === "bot_reply") {
          return pending && intent.replyToId === pending.id ? null : pending;
        }
        if (intent.type === "trigger") {
          return intent.msg;
        }
        return pending;
      }, null),
      distinctUntilChanged((a, b) => a?.id === b?.id),
      debounceTime(debounceMs),
      filter((msg): msg is ChatMessageAdded => msg !== null),
    );

    return intent$.pipe(switchMap((msg) => this.handleTrigger(this.spaceId, chatId, msg)));
  }

  private handleTrigger(spaceId: string, chatId: string, msg: ChatMessageAdded) {
    this.logger.log(`💬 Generating LLM response for chat ${chatId}...`);

    const abortController = new AbortController();

    return this.createProgressMessage(chatId, msg.id).pipe(
      tap((progressId) => {
        abortController.signal.addEventListener(
          "abort",
          () => {
            this.anytype.deleteChatMessage(spaceId, chatId, progressId).catch(() => {});
          },
          { once: true },
        );
      }),
      switchMap((progressId) => this.preparePayload(spaceId, chatId, msg, progressId)),
      switchMap(({ payload, progressId }) =>
        this.processLlmRun(
          // TODO: use object here instead of list of params
          spaceId,
          chatId,
          payload,
          progressId,
          abortController.signal,
          msg.id,
        ),
      ),
      catchError((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`❌ LLM run dropped: ${msg}`);
        return EMPTY;
      }),
      finalize(() => {
        // При отписке дергаем аборт (если еще не отменен)
        if (!abortController.signal.aborted) abortController.abort();
      }),
    );
  }

  private processLlmRun(
    spaceId: string,
    chatId: string,
    payload: object,
    progressId: string,
    abort: AbortSignal,
    replyToMessageId?: string,
  ): Observable<unknown> {
    return this.llm.run(spaceId, payload, abort).pipe(
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
        if (!trimmed) return EMPTY;

        return this.safe$(() =>
          this.anytype.addChatMessage(this.spaceId, chatId, {
            text: trimmed,
            reply_to_message_id: replyToMessageId,
          }),
        );
      }),
    );
  }

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

  // TODO: combine with preparePayload, fire addChatMessage & getChatMessages in parallel
  private createProgressMessage(chatId: string, replyToMessageId?: string): Observable<string> {
    return from(
      this.anytype.addChatMessage(this.spaceId, chatId, {
        text: INITIAL_PROGRESS_TEXT,
        marks: progressMarks(INITIAL_PROGRESS_TEXT),
        reply_to_message_id: replyToMessageId,
      }),
    ).pipe(
      timeout(PROGRESS_POST_TIMEOUT_MS),
      retry({ count: 1, delay: PROGRESS_RETRY_DELAY_MS }),
      map((res) => res.message_id),
    );
  }

  private preparePayload(
    spaceId: string,
    chatId: string,
    msg: ChatMessageAdded,
    progressId: string,
  ) {
    return from(this.anytype.getChatMessages(spaceId, chatId)).pipe(
      map((history) => ({ payload: { history, msg }, progressId })),
    );
  }

  private classifyMessage(chatId: string, msg: ChatMessageAdded): Observable<ChatIntent> {
    // 1. Message from the bot itself (cancels target trigger if replying to it)
    if (this.isBotId(msg.creator)) {
      return of({ type: "bot_reply", replyToId: msg.reply_to_message_id });
    }

    // 2. Direct mention of the bot
    if (this.mentionsBot(msg)) {
      return of({ type: "trigger", msg });
    }

    // 3. Reply to another message: check if replied message was from the bot
    if (msg.reply_to_message_id) {
      return from(this.anytype.getChatMessage(this.spaceId, chatId, msg.reply_to_message_id)).pipe(
        map((replied) =>
          this.isBotId(replied?.creator)
            ? ({ type: "trigger", msg } as const)
            : ({ type: "noop" } as const),
        ),
        catchError(() => of({ type: "noop" } as const)),
      );
    }

    // 4. Regular message / noise
    return of({ type: "noop" });
  }

  private readonly isBotId = (wire: string | undefined): boolean =>
    Boolean(wire?.endsWith(`_${this.botMemberId}`));

  private readonly mentionsBot = (msg: ChatMessageAdded): boolean =>
    Boolean(msg.content.marks?.some((m) => m.type === "mention" && this.isBotId(m.param)));
}
