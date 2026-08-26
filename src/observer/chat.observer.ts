import { Injectable } from "@nestjs/common";
import {
  debounceTime,
  filter,
  from,
  map,
  type Observable,
  of,
  retry,
  switchMap,
  takeUntil,
} from "rxjs";
import { AnytypeService, type Chat } from "../client";
import type { ChatEvent, ChatMessagePayload } from "../client/types";
import { AbstractObserver, type AgentEvent, type ObserverFactory } from "./types";

@Injectable()
export class ChatObserverFactory implements ObserverFactory {
  constructor(private readonly anytype: AnytypeService) {}

  create(spaceId: string, botName: string): ChatObserver {
    return new ChatObserver(spaceId, botName, this.anytype);
  }
}

export class ChatObserver extends AbstractObserver {
  private readonly MAX_HISTORY = 50;
  private readonly history = new Map<string, ChatMessagePayload>();

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
      filter((msg) => msg !== null),
      map((msg) => this.handleHistory(msg)),

      // 2. Anti-Echo: игнорируем сообщения от самого бота
      filter(
        (msg) =>
          "creator_name" in msg &&
          msg.creator_name.trim().toLowerCase() !== this.botName.toLowerCase(),
      ),

      debounceTime(800),

      // TODO: нужен настоящий доменный ChatEvent, с историей сообщений, курсором и так далее.
      // 4. Мапим в доменный AgentEvent
      map(
        (): AgentEvent => ({
          source: "chat",
          spaceId: this.spaceId,
          chatId,
          payload: Array.from(this.history.values()),
          timestamp: Date.now(),
        }),
      ),

      // 5. Resilience: реконнект при обрыве SSE
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
        return prev;
      }
      default:
        return msg;
    }
  };
}
