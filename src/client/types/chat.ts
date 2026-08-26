import Type, { type Static } from "typebox";

export const ChatReactions = Type.Union([
  Type.Null(),
  Type.Record(Type.String(), Type.Array(Type.String())),
]);
export type ChatReactions = Static<typeof ChatReactions>;

// 1. Core Chat Message Payload (Shared across SSE events and observer history)
export const ChatMessagePayload = Type.Object({
  id: Type.String(),
  order_id: Type.String(),
  creator: Type.String(),
  creator_name: Type.String(),
  created_at: Type.Number(),
  modified_at: Type.Number(),
  content: Type.Object({
    text: Type.String(),
    style: Type.String(),
  }),
  attachments: Type.Array(Type.Unknown()),
  reactions: ChatReactions,
  pinned: Type.Boolean(),
});
export type ChatMessagePayload = Static<typeof ChatMessagePayload>;

// 2. Raw SSE Event Schemas for TypeBox validation
export const RawChatMessageAdded = Type.Object({
  type: Type.Literal("message_added"),
  payload: Type.Object({ message: ChatMessagePayload }),
});
export type RawChatMessageAdded = Static<typeof RawChatMessageAdded>;

export const RawChatMessageUpdated = Type.Object({
  type: Type.Literal("message_updated"),
  payload: Type.Object({ message: ChatMessagePayload }),
});
export type RawChatMessageUpdated = Static<typeof RawChatMessageUpdated>;

export const RawChatMessageDeleted = Type.Object({
  type: Type.Literal("message_deleted"),
  payload: Type.Object({ id: Type.String() }),
});
export type RawChatMessageDeleted = Static<typeof RawChatMessageDeleted>;

export const RawReactionUpdated = Type.Object({
  type: Type.Literal("reactions_updated"),
  payload: Type.Object({
    id: Type.String(),
    reactions: ChatReactions,
  }),
});
export type RawReactionUpdated = Static<typeof RawReactionUpdated>;

// 3. Domain Chat Events (Discriminated Union)
export type ChatMessageAdded = ChatMessagePayload & { type: "message_added" };
export type ChatMessageUpdated = ChatMessagePayload & { type: "message_updated" };
export type ChatMessageDeleted = { type: "message_deleted"; id: string };
export type ReactionUpdated = { type: "reactions_updated"; id: string; reactions: ChatReactions };

export type ChatEvent =
  | ChatMessageAdded
  | ChatMessageUpdated
  | ChatMessageDeleted
  | ReactionUpdated;
