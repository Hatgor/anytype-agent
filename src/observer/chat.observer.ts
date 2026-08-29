import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  catchError,
  debounceTime,
  EMPTY,
  exhaustMap,
  filter,
  from,
  map,
  type Observable,
  of,
  retry,
  skip,
  switchMap,
  takeUntil,
} from "rxjs";
import type { AppConfig } from "../app.config";
import { AnytypeService, type Chat } from "../client";
import type { ChatEvent, ChatMessagePayload } from "../client/types";
import { LLM_SERVICE } from "../llm/llm.module";
import { AbstractLlmService, LlmAction, LlmResponse } from "../llm/types";
import { AbstractObserver, type ObserverFactory } from "./types";

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

// TODO: Подумать над обратной связью
// 1. Эмодзи при получении сообщения "на вход" (может револьверную смену реакций как суррогат лоадера?..)
// 2. Фиксация запросов к API через Proxy - вот тут короткоживущий токен ой как пригодится
// 3. Проверить лимиты API на редактирование сообщения по сценарию "ЛЛМ прислала запрос к прокси - мы создали / отредактировали техническое сообщение вида "запрашиваю список тасок""
// 4. Откат фидбека при ошибке/таймауте LLM: снять лоадер-реакцию / дописать "⚠️" в тех-сообщение в finally-семантике.
//    Сейчас catchError -> EMPTY глухо молчит — юзер не знает вообще, что бот пытался ответить.
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
      // TODO: After SQLite is done, check only by chatId, not by name
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

  private subscribeToChat(chatId: string) {
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

      // 2. Триггер — только чужие message_added:
      //    анти-эхо (игнор бота); правки, удаления и реакции LLM не будят
      filter(
        (msg) =>
          msg.type === "message_added" &&
          msg.creator_name.trim().toLowerCase() !== this.botName.toLowerCase(),
      ),

      // 3. Дебаунс: склеивает залп стартовых/пользовательских сообщений
      debounceTime(this.debounceMs),

      // tap(async () => {
      //   await (await import("node:fs/promises")).writeFile(
      //     `./src/chat-${chatId}.log`,
      //     JSON.stringify(this.history.values().toArray(), null, 2),
      //   );
      // }),

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

        // TODO: вынести в отдельную функцию
        return this.llm.run(spaceId, payload).pipe(
          switchMap((event) => {
            switch (true) {
              case event instanceof LlmAction:
                return this.handleLlmAction(chatId, event);
              case event instanceof LlmResponse:
                return this.handleLlmResponse(chatId, event);
              default:
                return EMPTY;
            }
          }),
          catchError((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`❌ LLM response failed: ${msg}`);
            return EMPTY;
          }),
        );
      }),

      // 8. Resilience: реконнект при обрыве SSE
      retry({ delay: this.retryDelayMs }),
    );
  }

  // TODO: создавать в рамках ответа TechMessage, группировать LlmAction как EDIT этого Message
  // TODO: удалять TechMessage после обработки LlmResponse
  private readonly handleLlmAction = (chatId: string, { detail }: LlmAction) => {
    const prefix = "⚡ LLM action: ";
    const text = `${prefix}${detail}`;

    return from(
      this.anytype.addChatMessage(this.spaceId, chatId, {
        text,
        marks: [{ type: "italic", from: prefix.length, to: text.length }],
      }),
    );
  };

  private readonly handleLlmResponse = (chatId: string, { text }: LlmResponse) => {
    return from(this.anytype.addChatMessage(this.spaceId, chatId, { text }));
  };

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
        // Наружу — само событие, а не prev: фильтр ниже различает события по msg.type,
        // а у prev type застрял на "message_added" — реакция замаскировалась бы под новое сообщение
        return msg;
      }
      default:
        return msg;
    }
  };
}
