import { Inject, Injectable, Logger } from "@nestjs/common";
import { map, type Observable } from "rxjs";
import { check } from "../type.registry";
import type { AnytypeClient } from "./anytype.client";
import { ANYTYPE_CLIENT } from "./client.constants";
import {
  type AddChatMessageBody,
  AddChatMessageResponse,
  type AnytypeObject,
  type AnytypeType,
  type Chat,
  type ChatMessage,
  ChatMessagesResponse,
  ChatResponse,
  ChatsResponse,
  type CreateChatBody,
  type CreateTypeBody,
  type EditChatMessageBody,
  EmptyResponse,
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
  type ToggleMessageReactionBody,
  TypeResponse,
  TypesResponse,
} from "./schema";
import {
  type ChatEvent,
  type ChatMessageAdded,
  RawChatMessageAdded,
  RawChatMessageDeleted,
  RawChatMessageUpdated,
  RawReactionUpdated,
} from "./types";

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

  async getSpacesWithMembers() {
    const spaces = await this.getSpaces();
    return await Promise.all(
      spaces.map(async (space) => {
        const members = await this.getMembers(space.id).catch((err) => {
          this.log.error(`Failed to fetch members for space ${space.id}: ${err}`);
          return [];
        });
        return { ...space, members };
      }),
    );
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

  async createChat(spaceId: string, body: CreateChatBody): Promise<Chat> {
    this.log.log(`Creating new chat "${body.name}" in space ${spaceId}...`);
    const res = await this.client.post(
      ChatResponse,
      `/v1/spaces/${encodeURIComponent(spaceId)}/chats`,
      body,
    );
    return res.chat;
  }

  async addChatMessage(
    spaceId: string,
    chatId: string,
    body: AddChatMessageBody,
  ): Promise<AddChatMessageResponse> {
    this.log.debug(`Sending message to chat ${chatId} in space ${spaceId}...`);
    return this.client.post(
      AddChatMessageResponse,
      `/v1/spaces/${encodeURIComponent(spaceId)}/chats/${encodeURIComponent(chatId)}/messages`,
      body,
    );
  }

  async editChatMessage(
    spaceId: string,
    chatId: string,
    messageId: string,
    body: EditChatMessageBody,
  ): Promise<EmptyResponse> {
    this.log.debug(`Editing message ${messageId} in chat ${chatId} (space ${spaceId})...`);
    return this.client.patch(
      EmptyResponse,
      `/v1/spaces/${encodeURIComponent(spaceId)}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
      body,
    );
  }

  async deleteChatMessage(
    spaceId: string,
    chatId: string,
    messageId: string,
  ): Promise<EmptyResponse> {
    this.log.debug(`Deleting message ${messageId} from chat ${chatId} in space ${spaceId}...`);
    return this.client.delete(
      EmptyResponse,
      `/v1/spaces/${encodeURIComponent(spaceId)}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
    );
  }

  async toggleMessageReaction(
    spaceId: string,
    chatId: string,
    messageId: string,
    body: ToggleMessageReactionBody,
  ): Promise<EmptyResponse> {
    this.log.debug(
      `Toggling reaction "${body.emoji}" on message ${messageId} in chat ${chatId} (space ${spaceId})...`,
    );
    return this.client.post(
      EmptyResponse,
      `/v1/spaces/${encodeURIComponent(spaceId)}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/reactions`,
      body,
    );
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
    return res.messages;
  }

  subscribeChatMessages(
    spaceId: string,
    chatId: string,
    // TODO: get rid of unknown here, use TypeBox validation
  ): Observable<ChatEvent | null> {
    this.log.log(`Subscribing to SSE chat stream for ${chatId} in space ${spaceId}...`);
    return this.client
      .stream(
        `/v1/spaces/${encodeURIComponent(spaceId)}/chats/${encodeURIComponent(chatId)}/messages/stream`,
      )
      .pipe(
        map(({ event, data }) => {
          switch (true) {
            case check(RawChatMessageAdded, data):
              return { type: data.type, ...data.payload.message };
            case check(RawChatMessageUpdated, data):
              return { type: data.type, ...data.payload.message };
            case check(RawChatMessageDeleted, data):
              return { type: data.type, id: data.payload.id };
            case check(RawReactionUpdated, data):
              return { type: data.type, ...data.payload };
            default:
              this.log.warn(`Unknown event: ${event}, data: ${JSON.stringify(data)}`);
              return null;
          }
        }),
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

  async createType(spaceId: string, body: CreateTypeBody): Promise<AnytypeType> {
    this.log.log(`Creating custom type "${body.name}" in space ${spaceId}...`);
    const res = await this.client.post(
      TypeResponse,
      `/v1/spaces/${encodeURIComponent(spaceId)}/types`,
      body,
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
