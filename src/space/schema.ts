import { Type, type Static } from "typebox";
import { MemberRole } from "../client/schemas";

export const SpaceContext = Type.Object({
  spaceId: Type.String(),
  spaceName: Type.String(),
  botMemberId: Type.String(),
  botIdentity: Type.String(),
  botName: Type.String(),
  botRole: MemberRole,
  chatId: Type.Optional(Type.String()),
  agentResponseTypeId: Type.Optional(Type.String()),
});
export type SpaceContext = Static<typeof SpaceContext>;

export const SpaceEvent = Type.Object(
  {
    source: Type.String(), // "sse_chat" | "object_search"
    spaceId: Type.String(),
    spaceName: Type.String(),
    payload: Type.Any(),
    receivedAt: Type.Number(),
  },
  { additionalProperties: true }
);
export type SpaceEvent = Static<typeof SpaceEvent>;
