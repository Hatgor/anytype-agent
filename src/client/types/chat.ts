import Type, { type Static } from "typebox";

export const ChatMessageAdded = Type.Object({
  type: Type.Literal("message_added"),
  payload: Type.Object({
    message: Type.Object({
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
      // TODO: define attachments type later
      attachments: Type.Array(Type.Unknown()),
      // TODO: define reactions type later
      reactions: Type.Array(Type.Unknown()),
      pinned: Type.Boolean(),
    }),
  }),
});
export type ChatMessageAdded = Static<typeof ChatMessageAdded>;
