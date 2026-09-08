import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ModelMessage } from "ai";
import {
  catchError,
  concatMap,
  debounceTime,
  defer,
  distinctUntilChanged,
  EMPTY,
  exhaustMap,
  filter,
  from,
  map,
  mergeMap,
  Observable,
  of,
  retry,
  scan,
  shareReplay,
  switchMap,
  takeLast,
  takeUntil,
  tap,
  throwIfEmpty,
  timeout,
  timer,
} from "rxjs";
import type { AppConfig } from "../app.config";
import type { ChatMessage } from "../client";
import { AnytypeService } from "../client/anytype.service";
import type { ChatMessageAdded } from "../client/types";
import { LlmService } from "../llm/llm.service";
import { LlmEmptyResponseError } from "../llm/types";
import { AbstractObserver, type ObserverFactory } from "./types";

@Injectable()
export class ChatsObserverFactory implements ObserverFactory {
  constructor(
    private readonly anytype: AnytypeService,
    private readonly llm: LlmService,
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

interface LlmRunState {
  messages: ModelMessage[];
  finalText: string;
  progressText: string | null;
}

type ChatIntent =
  | { type: "trigger"; msg: ChatMessageAdded }
  | { type: "bot_reply"; replyToId?: string }
  | { type: "noop" };

export class ChatsObserver extends AbstractObserver {
  constructor(
    private readonly spaceId: string,
    private readonly botMemberId: string,
    private readonly anytype: AnytypeService,
    private readonly llm: LlmService,
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
              this.logger.error(
                `Failed in chat ${chatId}: ${this.sanitizeErrorMessage(err)}`,
                err?.stack,
              );
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

  private handleTrigger(
    spaceId: string,
    chatId: string,
    msg: ChatMessageAdded,
  ): Observable<unknown> {
    this.logger.log(`💬 Generating LLM response for chat ${chatId}...`);

    return this.createProgressMessage(chatId, msg.id).pipe(
      switchMap((progressId) =>
        this.request$(() => this.anytype.getChatMessages(spaceId, chatId)).pipe(
          switchMap((chatHistory) =>
            this.processLlmRun(spaceId, chatId, chatHistory, progressId, msg.id),
          ),
          catchError((err) => this.handleLlmError(chatId, progressId, err)),
          tap({
            unsubscribe: () => {
              this.deleteProgressMessage(chatId, progressId).subscribe();
            },
          }),
        ),
      ),
      catchError((err) => {
        const errMsg = this.sanitizeErrorMessage(err);
        this.logger.error(`❌ Failed to initialize trigger for chat ${chatId}: ${errMsg}`);
        return EMPTY;
      }),
    );
  }

  private handleLlmError(chatId: string, progressId: string, err: unknown): Observable<never> {
    const errMsg = this.sanitizeErrorMessage(err);
    this.logger.error(`❌ LLM run failed: ${errMsg}`);

    const errorText = `⚠️ ${errMsg}`;
    return this.editProgressMessage(chatId, progressId, errorText).pipe(
      catchError((editErr) => {
        this.logger.warn(
          `Failed to update error text in chat: ${this.sanitizeErrorMessage(editErr)}. Deleting progress message.`,
        );
        return this.deleteProgressMessage(chatId, progressId);
      }),
      switchMap(() => EMPTY),
    );
  }

  private processLlmRun(
    spaceId: string,
    chatId: string,
    chatHistory: ChatMessage[],
    progressId: string,
    replyToMessageId?: string,
  ): Observable<unknown> {
    return this.llm.run(spaceId, chatId, this.botMemberId, chatHistory).pipe(
      scan<ModelMessage, LlmRunState>(
        (acc, msg) => ({
          messages: [...acc.messages, msg],
          finalText:
            msg.role === "assistant" && typeof msg.content === "string"
              ? msg.content
              : acc.finalText,
          progressText: this.formatStepProgress(msg),
        }),
        { messages: [], finalText: "", progressText: null },
      ),
      concatMap((state) => {
        if (!state.progressText) return of(state);

        return this.editProgressMessage(chatId, progressId, state.progressText).pipe(
          catchError(() => of(null)),
          map(() => state),
        );
      }),
      takeLast(1),
      throwIfEmpty(() => new LlmEmptyResponseError()),
      concatMap(({ messages, finalText }) => {
        const trimmed = finalText.trim();
        if (!trimmed) throw new LlmEmptyResponseError();

        return this.request$(() =>
          this.anytype.addChatMessage(spaceId, chatId, {
            text: trimmed,
            reply_to_message_id: replyToMessageId,
          }),
        ).pipe(
          concatMap((createdMsg) => {
            this.llm.save(spaceId, chatId, createdMsg.message_id, messages);
            return this.deleteProgressMessage(chatId, progressId);
          }),
        );
      }),
    );
  }

  private formatStepProgress(msg: ModelMessage): string | null {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const toolCall = msg.content.find((p) => p.type === "tool-call");
      if (toolCall && toolCall.type === "tool-call") {
        return `⚙️ Running: ${toolCall.toolName}...`;
      }
    }

    if (msg.role === "tool" && Array.isArray(msg.content)) {
      const toolResult = msg.content.find((p) => p.type === "tool-result");
      if (toolResult && toolResult.type === "tool-result") {
        return `📥 Received: ${toolResult.toolName}`;
      }
    }

    return null;
  }

  private request$<T>(
    factory: () => Promise<T>,
    options?: { timeoutMs?: number; retryCount?: number; retryDelayMs?: number },
  ): Observable<T> {
    const timeoutMs = options?.timeoutMs ?? SAFE_HTTP_TIMEOUT_MS;
    const retryCount = options?.retryCount ?? 0;

    return defer(factory).pipe(
      timeout(timeoutMs),
      retryCount > 0
        ? retry({ count: retryCount, delay: options?.retryDelayMs ?? PROGRESS_RETRY_DELAY_MS })
        : (source$) => source$,
    );
  }

  private progressBody(text: string) {
    return {
      text,
      marks: [{ type: "italic", from: 0, to: text.length }],
    };
  }

  private createProgressMessage(chatId: string, replyToMessageId?: string): Observable<string> {
    return this.request$(
      () =>
        this.anytype.addChatMessage(this.spaceId, chatId, {
          ...this.progressBody(INITIAL_PROGRESS_TEXT),
          reply_to_message_id: replyToMessageId,
        }),
      { timeoutMs: PROGRESS_POST_TIMEOUT_MS, retryCount: 1, retryDelayMs: PROGRESS_RETRY_DELAY_MS },
    ).pipe(map((res) => res.message_id));
  }

  private editProgressMessage(
    chatId: string,
    messageId: string,
    text: string,
  ): Observable<unknown> {
    return this.request$(() =>
      this.anytype.editChatMessage(this.spaceId, chatId, messageId, this.progressBody(text)),
    );
  }

  private deleteProgressMessage(chatId: string, messageId: string): Observable<void> {
    return this.request$(() =>
      this.anytype.deleteChatMessage(this.spaceId, chatId, messageId),
    ).pipe(
      map(() => void 0),
      catchError(() => EMPTY),
    );
  }

  private classifyMessage(chatId: string, msg: ChatMessageAdded): Observable<ChatIntent> {
    // 1. Message from the bot itself (cancels target trigger if replying to it)
    if (this.isBotId(msg.creator))
      return of({ type: "bot_reply", replyToId: msg.reply_to_message_id });

    // 2. Direct mention of the bot
    if (this.mentionsBot(msg)) return of({ type: "trigger", msg });

    // 3. Reply to another message: check if replied message was from the bot
    if (msg.reply_to_message_id) {
      const replyToId = msg.reply_to_message_id;
      return this.request$(() => this.anytype.getChatMessage(this.spaceId, chatId, replyToId)).pipe(
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

  private readonly sanitizeErrorMessage = (err: unknown): string => {
    const raw = err instanceof Error ? err.message : String(err);
    return raw.split("\n")[0]?.slice(0, 200) ?? "";
  };
}
