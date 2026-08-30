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
  skip,
  switchMap,
  takeUntil,
  timeout,
} from "rxjs";
import type { AppConfig } from "../app.config";
import { AnytypeService, type Chat } from "../client";
import type { ChatEvent, ChatMessagePayload } from "../client/types";
import { LLM_SERVICE } from "../llm/llm.module";
import { AbstractLlmService, LlmAction, type LlmEvent, LlmResponse } from "../llm/types";
import { AbstractObserver, type ObserverFactory } from "./types";

const INITIAL_PROGRESS_TEXT = "⏳ Working...";

// Прогресс-блок целиком курсивом — визуально отделяем "бот работает" от контента.
// Серый шрифт недоступен: спека не определяет color/font для текста сообщений.
const progressMarks = (text: string) => [{ type: "italic", from: 0, to: text.length }];

// Таймаут одного POST'а прогресса и пауза перед единственным ретраем.
// Не-config осознанно: это не ручка тюнинга, а страхователь от зависшего HTTP.
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

  create(spaceId: string, botName: string): ChatObserver {
    return new ChatObserver(
      spaceId,
      botName,
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
    return this.anytype.subscribeChatMessages(this.spaceId, chatId).pipe(
      filter((msg) => msg !== null),
      map((msg) => this.handleHistory(msg)),

      // 2. Триггер — только чужие message_added:
      //    анти-эхо (игнор бота); правки, удаления и реакции LLM не будят
      filter(
        (msg) =>
          msg.type === "message_added" &&
          msg.creator_name.trim().toLowerCase() !== this.botName.toLowerCase(),
      ),

      // 3. Дебаунс: склеивает залп стартовых/пользовательских сообщений
      debounceTime(this.debounceMs),

      // 4. Пропускаем ровно 1-е событие (стартовый бэкфилл 50 старых сообщений при подключении)
      skip(1),

      // 5. Формируем событие для LLM
      map(() => ({
        spaceId: this.spaceId,
        payload: Array.from(this.history.values()),
      })),

      // 6. 🛑 exhaustMap: пока LLM генерирует ответ — новые триггеры игнорируются
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

      // 7. Resilience: реконнект при обрыве SSE
      retry({ delay: this.retryDelayMs }),
    );
  }

  /**
   * Создание стартового прогресс-сообщения.
   * Чистый стрим: возвращает message_id. При фатале (после ретрая) ошибка летит
   * в catchError exhaustMap'а — LLM даже не вызывается, алиасы не текут.
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

  // TODO: удалять ProgressMessage после LlmResponse; откат ⚠️ при ошибке/таймауте рана
  /**
   * Чистый пайплайн обработки рана LLM:
   * 1. scan накапливает текст трейсов прямо в LlmAction (начальный сид — реальный LlmAction).
   * 2. LlmResponse пролетает сквозь scan без изменений.
   * 3. concatMap обеспечивает строгую FIFO-очередь сетевых вызовов (без race condition).
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
   * Устойчивый вызов Anytype API: одиночный упавший POST/PATCH не роняет стрим джобы.
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
