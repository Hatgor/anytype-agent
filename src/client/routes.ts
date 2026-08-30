/**
 * Документация доступных эндпоинтов Anytype API (спека 2025-11-08)
 * Спейсовые роуты (/v1/spaces/{space_id}/...) для LLM-промпта.
 * Можно точечно комментировать/отключать отдельные строки, чтобы не путать агента.
 */
export const SPACE_ROUTES: string[] = [
  // Space
  "- GET    /v1/spaces/{space_id} — Get space",
  "- PATCH  /v1/spaces/{space_id} — Update space",

  // Chats & Messages
  // "- GET    /v1/spaces/{space_id}/chats — List chats",
  // "- POST   /v1/spaces/{space_id}/chats — Create chat",
  // "- GET    /v1/spaces/{space_id}/chats/{chat_id}/messages — Get chat messages",
  // "- POST   /v1/spaces/{space_id}/chats/{chat_id}/messages — Add chat message",
  // "- DELETE /v1/spaces/{space_id}/chats/{chat_id}/messages/{message_id} — Delete chat message",
  // "- GET    /v1/spaces/{space_id}/chats/{chat_id}/messages/{message_id} — Get chat message",
  // "- PATCH  /v1/spaces/{space_id}/chats/{chat_id}/messages/{message_id} — Edit chat message",
  // "- POST   /v1/spaces/{space_id}/chats/{chat_id}/messages/{message_id}/reactions — Toggle message reaction",
  // "- POST   /v1/spaces/{space_id}/chats/{chat_id}/messages/read — Read messages",
  // "- GET    /v1/spaces/{space_id}/chats/{chat_id}/messages/search — Search chat messages",
  // "- POST   /v1/spaces/{space_id}/chats/{chat_id}/reactions/read — Read reactions",
  // "- POST   /v1/spaces/{space_id}/chats/{chat_id}/read_all — Mark chat as read",

  // Files
  "- POST   /v1/spaces/{space_id}/files — Upload file",
  "- DELETE /v1/spaces/{space_id}/files/{file_id} — Delete file",
  "- GET    /v1/spaces/{space_id}/files/{file_id} — Download file",

  // Lists & Views
  "- POST   /v1/spaces/{space_id}/lists/{list_id}/objects — Add objects to list",
  "- DELETE /v1/spaces/{space_id}/lists/{list_id}/objects/{object_id} — Remove object from list",
  "- GET    /v1/spaces/{space_id}/lists/{list_id}/views — Get list views",
  "- GET    /v1/spaces/{space_id}/lists/{list_id}/views/{view_id}/objects — Get objects in list",

  // Members
  "- GET    /v1/spaces/{space_id}/members — List members",
  "- GET    /v1/spaces/{space_id}/members/{member_id} — Get member",

  // Objects & Search
  "- GET    /v1/spaces/{space_id}/objects — List objects",
  "- POST   /v1/spaces/{space_id}/objects — Create object",
  "- DELETE /v1/spaces/{space_id}/objects/{object_id} — Delete object",
  "- GET    /v1/spaces/{space_id}/objects/{object_id} — Get object",
  "- PATCH  /v1/spaces/{space_id}/objects/{object_id} — Update object",
  "- POST   /v1/spaces/{space_id}/search — Search objects within a space",

  // Properties & Tags
  "- GET    /v1/spaces/{space_id}/properties — List properties",
  "- POST   /v1/spaces/{space_id}/properties — Create property",
  "- DELETE /v1/spaces/{space_id}/properties/{property_id} — Delete property",
  "- GET    /v1/spaces/{space_id}/properties/{property_id} — Get property",
  "- PATCH  /v1/spaces/{space_id}/properties/{property_id} — Update property",
  "- GET    /v1/spaces/{space_id}/properties/{property_id}/tags — List tags",
  "- POST   /v1/spaces/{space_id}/properties/{property_id}/tags — Create tag",
  "- DELETE /v1/spaces/{space_id}/properties/{property_id}/tags/{tag_id} — Delete tag",
  "- GET    /v1/spaces/{space_id}/properties/{property_id}/tags/{tag_id} — Get tag",
  "- PATCH  /v1/spaces/{space_id}/properties/{property_id}/tags/{tag_id} — Update tag",

  // Types & Templates
  "- GET    /v1/spaces/{space_id}/types — List types",
  "- POST   /v1/spaces/{space_id}/types — Create type",
  "- DELETE /v1/spaces/{space_id}/types/{type_id} — Delete type",
  "- GET    /v1/spaces/{space_id}/types/{type_id} — Get type",
  "- PATCH  /v1/spaces/{space_id}/types/{type_id} — Update type",
  "- GET    /v1/spaces/{space_id}/types/{type_id}/templates — List templates",
  "- GET    /v1/spaces/{space_id}/types/{type_id}/templates/{template_id} — Get template",
];

export const SPACE_ROUTES_DOC: string = SPACE_ROUTES.join("\n");
