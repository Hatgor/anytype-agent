import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Observable } from "rxjs";
import type { AnytypeClient } from "./anytype.client";
import { ANYTYPE_CLIENT } from "./client.constants";
import {
  type AddChatMessageRequest,
  type AnytypeObject,
  type AnytypeType,
  type Chat,
  type ChatMessage,
  ChatMessageResponse,
  ChatMessagesResponse,
  ChatResponse,
  ChatsResponse,
  type CreateChatRequest,
  type CreateTypeRequest,
  type Member,
  MemberResponse,
  MembersResponse,
  ObjectResponse,
  ObjectsResponse,
  type ObjectWithBody,
  type SearchRequest,
  type Space,
  SpaceResponse,
  SpacesResponse,
  TypeResponse,
  TypesResponse,
} from "./schema";

@Injectable()
export class AnytypeService {
  private readonly log = new Logger(AnytypeService.name);

  constructor(@Inject(ANYTYPE_CLIENT) private readonly client: AnytypeClient) {}

  // --- Spaces ---

  async getSpaces(): Promise<Space[]> {
    this.log.debug("Fetching spaces list...");
    const res = await this.client.get(SpacesResponse, "/v1/spaces");
    this.log.debug(`Retrieved ${res.data.length} space(s)`);
    return res.data;
  }

  async getSpace(spaceId: string): Promise<Space> {
    this.log.debug(`Fetching space details for ${spaceId}...`);
    const res = await this.client.get(SpaceResponse, `/v1/spaces/${encodeURIComponent(spaceId)}`);
    return res.space;
  }

  // --- Members ---

  async getMembers(spaceId: string): Promise<Member[]> {
    this.log.debug(`Fetching members for space ${spaceId}...`);
    const res = await this.client.get(
      MembersResponse,
      `/v1/spaces/${encodeURIComponent(spaceId)}/members`,
    );
    return res.data;
  }

  async getMember(spaceId: string, memberId: string): Promise<Member> {
    this.log.debug(`Fetching member ${memberId} in space ${spaceId}...`);
    const res = await this.client.get(
      MemberResponse,
      `/v1/spaces/${encodeURIComponent(spaceId)}/members/${encodeURIComponent(memberId)}`,
    );
    return res.member;
  }

  // --- Chats & Messages ---

  async getChats(spaceId: string): Promise<Chat[]> {
    this.log.debug(`Fetching chats for space ${spaceId}...`);
    const res = await this.client.get(
      ChatsResponse,
      `/v1/spaces/${encodeURIComponent(spaceId)}/chats`,
    );
    return res.data;
  }

  async createChat(payload: CreateChatRequest): Promise<Chat> {
    this.log.log(`Creating new chat "${payload.name}" in space ${payload.space_id}...`);
    const res = await this.client.post(
      ChatResponse,
      `/v1/spaces/${encodeURIComponent(payload.space_id)}/chats`,
      payload,
    );
    return res.chat;
  }

  async addChatMessage(payload: AddChatMessageRequest): Promise<ChatMessage> {
    this.log.debug(`Sending message to chat ${payload.chat_id} in space ${payload.space_id}...`);
    const res = await this.client.post(
      ChatMessageResponse,
      `/v1/spaces/${encodeURIComponent(payload.space_id)}/chats/${encodeURIComponent(payload.chat_id)}/messages`,
      {
        text: payload.text,
        ...(payload.reply_to_message_id
          ? { reply_to_message_id: payload.reply_to_message_id }
          : {}),
      },
    );
    return res.message;
  }

  async getChatMessages(
    spaceId: string,
    chatId: string,
    limit = 20,
    offset = 0,
  ): Promise<ChatMessage[]> {
    this.log.debug(
      `Fetching chat messages for chat ${chatId} (limit: ${limit}, offset: ${offset})...`,
    );
    const res = await this.client.get(
      ChatMessagesResponse,
      `/v1/spaces/${encodeURIComponent(spaceId)}/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}&offset=${offset}`,
    );
    return res.data;
  }

  subscribeChatMessages(
    spaceId: string,
    chatId: string,
    // TODO: get rid of unknown here, use TypeBox validation
  ): Observable<{ event?: string; data: unknown }> {
    this.log.log(`Subscribing to SSE chat stream for ${chatId} in space ${spaceId}...`);
    return this.client.stream(
      `/v1/spaces/${encodeURIComponent(spaceId)}/chats/${encodeURIComponent(chatId)}/messages/stream`,
    );
  }

  // --- Types ---

  async getTypes(spaceId: string): Promise<AnytypeType[]> {
    this.log.debug(`Fetching types for space ${spaceId}...`);
    const res = await this.client.get(
      TypesResponse,
      `/v1/spaces/${encodeURIComponent(spaceId)}/types`,
    );
    return res.data;
  }

  async createType(payload: CreateTypeRequest): Promise<AnytypeType> {
    this.log.log(`Creating custom type "${payload.name}" in space ${payload.space_id}...`);
    const res = await this.client.post(
      TypeResponse,
      `/v1/spaces/${encodeURIComponent(payload.space_id)}/types`,
      payload,
    );
    return res.type;
  }

  // --- Objects & Search ---

  async searchSpace(spaceId: string, payload: SearchRequest = {}): Promise<AnytypeObject[]> {
    this.log.debug(`Searching space ${spaceId} (query: "${payload.query || ""}")`);
    const res = await this.client.post(
      ObjectsResponse,
      `/v1/spaces/${encodeURIComponent(spaceId)}/search`,
      payload,
    );
    return res.data;
  }

  async getObject(spaceId: string, objectId: string, format = "md"): Promise<ObjectWithBody> {
    this.log.debug(`Fetching object ${objectId} in space ${spaceId} (format: ${format})...`);
    const res = await this.client.get(
      ObjectResponse,
      `/v1/spaces/${encodeURIComponent(spaceId)}/objects/${encodeURIComponent(objectId)}?format=${format}`,
    );
    return res.object;
  }
}
