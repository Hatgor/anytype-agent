import { Injectable } from "@nestjs/common";
import { filter, from, map, type Observable, of, retry, switchMap, takeUntil, tap } from "rxjs";
import { AnytypeService, type Chat } from "../client";
import { AbstractObserver, type AgentEvent, type ObserverFactory } from "./types";

@Injectable()
export class ChatObserverFactory implements ObserverFactory {
  constructor(private readonly anytype: AnytypeService) {}

  create(spaceId: string, botName: string): ChatObserver {
    return new ChatObserver(spaceId, botName, this.anytype);
  }
}

export class ChatObserver extends AbstractObserver {
  constructor(
    private readonly spaceId: string,
    private readonly botName: string,
    private readonly anytype: AnytypeService,
  ) {
    super();

    this.getOrCreateChat()
      .pipe(
        switchMap((chat) => this.subscribeToChat(chat.id)),
        takeUntil(this.destroy$),
      )
      .subscribe((msg) => this.events$.next(msg));
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

  private subscribeToChat(chatId: string): Observable<AgentEvent> {
    return this.anytype.subscribeChatMessages(this.spaceId, chatId).pipe(
      // tap((msg) => {
      //   this.logger.debug(msg);
      // }),
      filter((msg) => msg !== null),

      // TODO: полная жопа с типами, надо их переделать, нихера не понятно
      // 2. Anti-Echo: игнорируем сообщения от самого бота
      // filter((msg) => msg.creator_name?.trim().toLowerCase()
      // !== this.botName.toLowerCase()),

      // TODO: настоящая дедупликация нужна через Ring Buffer с подгрузкой при инициализации и SQLite
      // 3. Дедупликация: не повторяем то, что уже видели
      // filter((msg) => {
      //   if (msg.id === this.lastSeenMessageId) return false;
      //   this.lastSeenMessageId = msg.id;
      //   return true;
      // }),

      // TODO: нужен дебаунс обязательно!!!

      // TODO: нужен настоящий доменный ChatEvent, с историей сообщений, курсором и так далее.
      // 4. Мапим в доменный AgentEvent
      map(
        (msg): AgentEvent => ({
          source: "chat",
          spaceId: this.spaceId,
          chatId,
          payload: msg,
          timestamp: Date.now(),
        }),
      ),

      // 5. Resilience: реконнект при обрыве SSE
      retry({ delay: 3000 }),
    );
  }
}
