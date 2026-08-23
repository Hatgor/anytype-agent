import Type, { type Static } from "typebox";


export const AppConfig = Type.Object({
  ANYTYPE_API_URL: Type.String(),
  ANYTYPE_BOT_NAME: Type.String(),
  ANYTYPE_API_KEY: Type.String(),
})
export type AppConfig = Static<typeof AppConfig>
