import { type Static, Type } from "typebox";

// --- Enums & Primitives ---

export const MemberRole = Type.Union([
  Type.Literal("viewer"),
  Type.Literal("editor"),
  Type.Literal("owner"),
  Type.Literal("no_permission"),
  Type.Literal("admin"),
]);
export type MemberRole = Static<typeof MemberRole>;

export const MemberStatus = Type.Union([
  Type.Literal("joining"),
  Type.Literal("active"),
  Type.Literal("removed"),
  Type.Literal("declined"),
  Type.Literal("removing"),
  Type.Literal("canceled"),
]);
export type MemberStatus = Static<typeof MemberStatus>;

export const Color = Type.Union([
  Type.Literal("grey"),
  Type.Literal("yellow"),
  Type.Literal("orange"),
  Type.Literal("red"),
  Type.Literal("pink"),
  Type.Literal("purple"),
  Type.Literal("blue"),
  Type.Literal("ice"),
  Type.Literal("teal"),
  Type.Literal("lime"),
]);
export type Color = Static<typeof Color>;

export const Icon = Type.Object(
  {
    format: Type.Optional(
      Type.Union([
        Type.Literal("icon"),
        Type.Literal("emoji"),
        Type.Literal("file"),
        Type.String(),
      ]),
    ),
    name: Type.Optional(Type.String()),
    color: Type.Optional(Color),
    emoji: Type.Optional(Type.String()),
    file: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
export type Icon = Static<typeof Icon>;

export const PaginationMeta = Type.Object(
  {
    total: Type.Number(),
    offset: Type.Number(),
    limit: Type.Number(),
    has_more: Type.Boolean(),
  },
  { additionalProperties: true },
);
export type PaginationMeta = Static<typeof PaginationMeta>;

// --- Space Schemas ---

export const Space = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    description: Type.Optional(Type.String()),
    icon: Type.Optional(Type.Union([Icon, Type.Null()])),
    network_id: Type.Optional(Type.String()),
    gateway_url: Type.Optional(Type.String()),
    object: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
export type Space = Static<typeof Space>;

export const SpacesResponse = Type.Object(
  {
    data: Type.Array(Space),
    pagination: Type.Optional(PaginationMeta),
  },
  { additionalProperties: true },
);
export type SpacesResponse = Static<typeof SpacesResponse>;

export const SpaceResponse = Type.Object(
  {
    space: Space,
  },
  { additionalProperties: true },
);
export type SpaceResponse = Static<typeof SpaceResponse>;

// --- Member Schemas ---

export const Member = Type.Object(
  {
    id: Type.String(),
    identity: Type.String(),
    name: Type.String(),
    global_name: Type.Optional(Type.String()),
    role: MemberRole,
    status: MemberStatus,
    icon: Type.Optional(Type.Union([Icon, Type.Null()])),
    object: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
export type Member = Static<typeof Member>;

export const MembersResponse = Type.Object(
  {
    data: Type.Array(Member),
    pagination: Type.Optional(PaginationMeta),
  },
  { additionalProperties: true },
);
export type MembersResponse = Static<typeof MembersResponse>;

export const MemberResponse = Type.Object(
  {
    member: Member,
  },
  { additionalProperties: true },
);
export type MemberResponse = Static<typeof MemberResponse>;

// --- Chat Schemas ---

export const Chat = Type.Object(
  {
    id: Type.String(),
    name: Type.Optional(Type.String()),
    space_id: Type.Optional(Type.String()),
    snippet: Type.Optional(Type.String()),
    layout: Type.Optional(Type.String()),
    archived: Type.Optional(Type.Boolean()),
    icon: Type.Optional(Type.Union([Icon, Type.Null()])),
    object: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
export type Chat = Static<typeof Chat>;

export const ChatsResponse = Type.Object(
  {
    data: Type.Array(Chat),
    pagination: Type.Optional(PaginationMeta),
  },
  { additionalProperties: true },
);
export type ChatsResponse = Static<typeof ChatsResponse>;

export const ChatResponse = Type.Object(
  {
    chat: Chat,
  },
  { additionalProperties: true },
);
export type ChatResponse = Static<typeof ChatResponse>;

export const CreateChatRequest = Type.Object({
  space_id: Type.String(),
  name: Type.String(),
  icon: Type.Optional(Icon),
});
export type CreateChatRequest = Static<typeof CreateChatRequest>;

export const MessageContent = Type.Object(
  {
    text: Type.Optional(Type.String()),
    style: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
export type MessageContent = Static<typeof MessageContent>;

export const ChatMessage = Type.Object(
  {
    id: Type.String(),
    text: Type.Optional(Type.String()),
    content: Type.Optional(MessageContent),
    author_id: Type.Optional(Type.String()),
    creator: Type.Optional(Type.String()),
    creator_name: Type.Optional(Type.String()),
    created_at: Type.Optional(Type.Union([Type.String(), Type.Number()])),
    reply_to_message_id: Type.Optional(Type.String()),
    reactions: Type.Optional(Type.Record(Type.String(), Type.Array(Type.String()))),
  },
  { additionalProperties: true },
);
export type ChatMessage = Static<typeof ChatMessage>;

export const ChatMessagesResponse = Type.Object(
  {
    data: Type.Array(ChatMessage),
    pagination: Type.Optional(PaginationMeta),
  },
  { additionalProperties: true },
);
export type ChatMessagesResponse = Static<typeof ChatMessagesResponse>;

export const ChatMessageResponse = Type.Object(
  {
    message: ChatMessage,
  },
  { additionalProperties: true },
);
export type ChatMessageResponse = Static<typeof ChatMessageResponse>;

export const AddChatMessageRequest = Type.Object({
  space_id: Type.String(),
  chat_id: Type.String(),
  text: Type.String(),
  reply_to_message_id: Type.Optional(Type.String()),
});
export type AddChatMessageRequest = Static<typeof AddChatMessageRequest>;

// --- Type Schemas ---

export const ObjectLayout = Type.Union([
  Type.Literal("basic"),
  Type.Literal("profile"),
  Type.Literal("action"),
  Type.Literal("note"),
  Type.Literal("bookmark"),
  Type.Literal("set"),
  Type.Literal("collection"),
  Type.Literal("participant"),
]);
export type ObjectLayout = Static<typeof ObjectLayout>;

export const PropertyFormat = Type.Union([
  Type.Literal("text"),
  Type.Literal("number"),
  Type.Literal("select"),
  Type.Literal("multi_select"),
  Type.Literal("date"),
  Type.Literal("files"),
  Type.Literal("checkbox"),
  Type.Literal("url"),
  Type.Literal("email"),
  Type.Literal("phone"),
  Type.Literal("objects"),
]);
export type PropertyFormat = Static<typeof PropertyFormat>;

export const TypeProperty = Type.Object(
  {
    key: Type.String(),
    name: Type.String(),
    format: PropertyFormat,
    id: Type.Optional(Type.String()),
    object: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
export type TypeProperty = Static<typeof TypeProperty>;

export const AnytypeType = Type.Object(
  {
    id: Type.String(),
    key: Type.String(),
    name: Type.String(),
    plural_name: Type.String(),
    layout: Type.Optional(ObjectLayout),
    archived: Type.Optional(Type.Boolean()),
    icon: Type.Optional(Type.Union([Icon, Type.Null()])),
    properties: Type.Optional(Type.Array(TypeProperty)),
    object: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
export type AnytypeType = Static<typeof AnytypeType>;

export const TypesResponse = Type.Object(
  {
    data: Type.Array(AnytypeType),
    pagination: Type.Optional(PaginationMeta),
  },
  { additionalProperties: true },
);
export type TypesResponse = Static<typeof TypesResponse>;

export const TypeResponse = Type.Object(
  {
    type: AnytypeType,
  },
  { additionalProperties: true },
);
export type TypeResponse = Static<typeof TypeResponse>;

export const CreateTypeRequest = Type.Object({
  space_id: Type.String(),
  name: Type.String(),
  plural_name: Type.String(),
  layout: ObjectLayout,
  key: Type.Optional(Type.String()),
  icon: Type.Optional(Icon),
  properties: Type.Optional(Type.Array(TypeProperty)),
});
export type CreateTypeRequest = Static<typeof CreateTypeRequest>;

// --- Object & Search Schemas ---

export const AnytypeObject = Type.Object(
  {
    id: Type.String(),
    name: Type.Optional(Type.String()),
    snippet: Type.Optional(Type.String()),
    layout: Type.Optional(Type.String()),
    space_id: Type.Optional(Type.String()),
    archived: Type.Optional(Type.Boolean()),
    object: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
export type AnytypeObject = Static<typeof AnytypeObject>;

export const ObjectsResponse = Type.Object(
  {
    data: Type.Array(AnytypeObject),
    pagination: Type.Optional(PaginationMeta),
  },
  { additionalProperties: true },
);
export type ObjectsResponse = Static<typeof ObjectsResponse>;

export const ObjectProperty = Type.Object(
  {
    id: Type.Optional(Type.String()),
    key: Type.Optional(Type.String()),
    name: Type.Optional(Type.String()),
    format: Type.Optional(Type.String()),
    date: Type.Optional(Type.String()),
    objects: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
  },
  { additionalProperties: true },
);
export type ObjectProperty = Static<typeof ObjectProperty>;

export const ObjectWithBody = Type.Object(
  {
    id: Type.String(),
    name: Type.Optional(Type.String()),
    snippet: Type.Optional(Type.String()),
    markdown: Type.Optional(Type.String()),
    layout: Type.Optional(Type.String()),
    space_id: Type.Optional(Type.String()),
    archived: Type.Optional(Type.Boolean()),
    object: Type.Optional(Type.String()),
    properties: Type.Optional(Type.Array(ObjectProperty)),
    type: Type.Optional(AnytypeType),
  },
  { additionalProperties: true },
);
export type ObjectWithBody = Static<typeof ObjectWithBody>;

export const ObjectResponse = Type.Object(
  {
    object: ObjectWithBody,
  },
  { additionalProperties: true },
);
export type ObjectResponse = Static<typeof ObjectResponse>;

export const SearchRequest = Type.Object({
  query: Type.Optional(Type.String()),
  types: Type.Optional(Type.Array(Type.String())),
  limit: Type.Optional(Type.Number()),
  offset: Type.Optional(Type.Number()),
  sort: Type.Optional(Type.String()),
});
export type SearchRequest = Static<typeof SearchRequest>;
