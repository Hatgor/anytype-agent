import { Inject, Injectable } from "@nestjs/common";
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
import { AnytypeService, type Chat } from "../client";
import type { ChatEvent, ChatMessagePayload } from "../client/types";
import { LLM_SERVICE } from "../llm/llm.module";
import { AbstractLlmService } from "../llm/types";
import { AbstractObserver, type AgentEvent, type ObserverFactory } from "./types";

@Injectable()
export class ChatObserverFactory implements ObserverFactory {
  constructor(
    private readonly anytype: AnytypeService,
    @Inject(LLM_SERVICE) private readonly llm: AbstractLlmService,
  ) {}

  create(spaceId: string, botName: string): ChatObserver {
    return new ChatObserver(spaceId, botName, this.anytype, this.llm);
  }
}

// TODO: Подумать над обратной связью
// 1. Эмодзи при получении сообщения "на вход" (может револьверную смену реакций как суррогат лоадера?..)
// 2. Фиксация запросов к API через Proxy - вот тут короткоживущий токен ой как пригодится
// 3. Проверить лимиты API на редактирование сообщения по сценарию "ЛЛМ прислала запрос к прокси - мы создали / отредактировали техническое сообщение вида "запрашиваю список тасок""
export class ChatObserver extends AbstractObserver {
  private readonly MAX_HISTORY = 50;
  private readonly history = new Map<string, ChatMessagePayload>();

  constructor(
    private readonly spaceId: string,
    private readonly botName: string,
    private readonly anytype: AnytypeService,
    private readonly llm: AbstractLlmService,
  ) {
    super();
  }

  run(): Observable<void> {
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
          : this.anytype.createChat({
              space_id: this.spaceId,
              name: this.botName,
            }),
      ),
    );
  }

  private subscribeToChat(chatId: string): Observable<void> {
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
      debounceTime(800),

      // 4. Пропускаем ровно 1-е событие (стартовый бэкфилл 50 старых сообщений при подключении)
      skip(1),

      // 5. Формируем событие для LLM
      map(
        (): AgentEvent => ({
          source: "chat",
          spaceId: this.spaceId,
          chatId,
          payload: Array.from(this.history.values()),
          timestamp: Date.now(),
        }),
      ),

      // 6. 🛑 exhaustMap: пока LLM генерирует ответ — новые триггеры игнорируются
      exhaustMap((event) => {
        this.logger.log(`💬 Generating LLM response for chat ${chatId}...`);

        // TODO: вынести в отдельную функцию
        return from(this.llm.generateResponse(event)).pipe(
          map((text) => text?.trim()),
          // Защита: пропускаем только непустые строки ответа
          filter((replyText): replyText is string => Boolean(replyText && replyText.length > 0)),
          // 7. Отправляем ответ в чат Anytype
          switchMap((validReplyText) =>
            from(
              this.anytype.addChatMessage({
                space_id: this.spaceId,
                chat_id: chatId,
                text: validReplyText,
              }),
            ),
          ),
          map(() => undefined),
          catchError((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`❌ LLM response failed: ${msg}`);
            return EMPTY;
          }),
        );
      }),

      // 8. Resilience: реконнект при обрыве SSE
      retry({ delay: 3000 }),
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
        // Наружу — само событие, а не prev: фильтр ниже различает события по msg.type,
        // а у prev type застрял на "message_added" — реакция замаскировалась бы под новое сообщение
        return msg;
      }
      default:
        return msg;
    }
  };
}
