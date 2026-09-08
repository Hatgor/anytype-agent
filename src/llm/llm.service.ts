import { Injectable } from "@nestjs/common";
import type { ModelMessage } from "ai";
import { defer, type Observable } from "rxjs";
import type { ChatMessage } from "../client";
import { AbstractLlmProvider } from "./types";

// TODO: make a proper signed string
type SpaceId = string;
type ChatId = string;
type RunId = string;
type BotId = string;

@Injectable()
export class LlmService {
  private readonly toBeMovedToDb: Map<SpaceId, Map<ChatId, Map<RunId, ModelMessage[]>>> = new Map();

  constructor(private readonly llmProvider: AbstractLlmProvider) {}

  run(
    spaceId: SpaceId,
    chatId: ChatId,
    botId: BotId,
    messages: ChatMessage[],
  ): Observable<ModelMessage> {
    return defer(() => {
      const history = messages.flatMap((message) => {
        const savedTurn = this.toBeMovedToDb.get(spaceId)?.get(chatId)?.get(message.id);
        return savedTurn ?? this.mapChatToModel(message, botId);
      });

      return this.llmProvider.run(spaceId, history);
    });
  }

  save(spaceId: SpaceId, chatId: ChatId, runId: RunId, messages: ModelMessage[]): void {
    let spaceMap = this.toBeMovedToDb.get(spaceId);
    // biome-ignore lint/suspicious/noAssignInExpressions: Simple one-liner
    if (!spaceMap) this.toBeMovedToDb.set(spaceId, (spaceMap = new Map()));

    let chatMap = spaceMap.get(chatId);
    // biome-ignore lint/suspicious/noAssignInExpressions: Simple one-liner
    if (!chatMap) spaceMap.set(chatId, (chatMap = new Map()));

    this.toBeMovedToDb.get(spaceId)?.get(chatId)?.set(runId, messages);
  }

  private readonly mapChatToModel = (message: ChatMessage, botId: BotId): ModelMessage => {
    return {
      role: this.isBotId(message.creator, botId) ? "assistant" : "user",
      content: message.content?.text ?? "",
    };
  };

  private readonly isBotId = (wire: string | undefined, botId: BotId): boolean =>
    Boolean(wire?.endsWith(`_${botId}`));
}
