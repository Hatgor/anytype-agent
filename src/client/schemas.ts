import { Type, type Static } from "typebox";

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

export const Icon = Type.Optional(
  Type.Object({
    format: Type.Optional(Type.Union([Type.Literal("icon"), Type.Literal("emoji"), Type.Literal("file")])),
    name: Type.Optional(Type.String()),
    color: Type.Optional(Color),
    emoji: Type.Optional(Type.String()),
    file: Type.Optional(Type.String()),
  })
);
export type Icon = Static<typeof Icon>;

export const PaginationMeta = Type.Object({
  total: Type.Number(),
  offset: Type.Number(),
  limit: Type.Number(),
  has_more: Type.Boolean(),
});
export type PaginationMeta = Static<typeof PaginationMeta>;

// --- Space Schemas ---

export const Space = Type.Object({
  id: Type.String(),
  name: Type.String(),
  description: Type.Optional(Type.String()),
  icon: Type.Optional(Type.Union([Icon, Type.Null()])),
  network_id: Type.Optional(Type.String()),
  gateway_url: Type.Optional(Type.String()),
  object: Type.Optional(Type.String()),
});
export type Space = Static<typeof Space>;

export const SpacesResponse = Type.Object({
  data: Type.Array(Space),
  pagination: Type.Optional(PaginationMeta),
});
export type SpacesResponse = Static<typeof SpacesResponse>;

export const SpaceResponse = Type.Object({
  space: Space,
});
export type SpaceResponse = Static<typeof SpaceResponse>;

// --- Member Schemas ---

export const Member = Type.Object({
  id: Type.String(),
  identity: Type.String(),
  name: Type.String(),
  global_name: Type.Optional(Type.String()),
  role: MemberRole,
  status: MemberStatus,
  icon: Type.Optional(Type.Union([Icon, Type.Null()])),
  object: Type.Optional(Type.String()),
});
export type Member = Static<typeof Member>;

export const MembersResponse = Type.Object({
  data: Type.Array(Member),
  pagination: Type.Optional(PaginationMeta),
});
export type MembersResponse = Static<typeof MembersResponse>;

export const MemberResponse = Type.Object({
  member: Member,
});
export type MemberResponse = Static<typeof MemberResponse>;

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

export const TypeProperty = Type.Object({
  key: Type.String(),
  name: Type.String(),
  format: PropertyFormat,
  id: Type.Optional(Type.String()),
  object: Type.Optional(Type.String()),
});
export type TypeProperty = Static<typeof TypeProperty>;

export const AnytypeType = Type.Object({
  id: Type.String(),
  key: Type.String(),
  name: Type.String(),
  plural_name: Type.String(),
  layout: Type.Optional(ObjectLayout),
  archived: Type.Optional(Type.Boolean()),
  icon: Type.Optional(Type.Union([Icon, Type.Null()])),
  properties: Type.Optional(Type.Array(TypeProperty)),
  object: Type.Optional(Type.String()),
});
export type AnytypeType = Static<typeof AnytypeType>;

export const TypesResponse = Type.Object({
  data: Type.Array(AnytypeType),
  pagination: Type.Optional(PaginationMeta),
});
export type TypesResponse = Static<typeof TypesResponse>;

export const TypeResponse = Type.Object({
  type: AnytypeType,
});
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

// --- App Context (Init output) ---

export const AppContext = Type.Object({
  apiUrl: Type.String(),
  spaceId: Type.String(),
  spaceName: Type.String(),
  botMemberId: Type.String(),
  botIdentity: Type.String(),
  botName: Type.String(),
  botRole: MemberRole,
  agentResponseTypeId: Type.Optional(Type.String()),
});
export type AppContext = Static<typeof AppContext>;
