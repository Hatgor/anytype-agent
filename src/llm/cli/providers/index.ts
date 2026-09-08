import { Injectable, Logger } from "@nestjs/common";
import type { ModelMessage } from "ai";
import type { Observable } from "rxjs";

@Injectable()
export abstract class AbstractLlmCli {
  protected readonly logger = new Logger(this.constructor.name);

  abstract exec(messages: ModelMessage[]): Observable<ModelMessage>;
}

export function buildSystemMessage(
  botName: string,
  proxyUrl: string,
  docs: string,
  spaceAlias: string,
): ModelMessage {
  return {
    role: "system",
    content: `You are the AI assistant "${botName}" in Anytype.

Instructions for interacting with Anytype:
- To read or modify data, use the local REST API proxy: ${proxyUrl}
- You have access to the following APIs:
${docs}
- Authorization: Already configured in the proxy server; Bearer tokens and required headers are automatically injected.
- Current Space ID: ${spaceAlias || "unknown"}

Communication & Language Guidelines:
- ALWAYS respond in the exact same language used by the user in their message or query (e.g., if the user wrote in Russian, answer in Russian; if in English, answer in English).
- Formulate a helpful, structured, and clear response.
- Never show the user SPACE ID;
- Do not use Markdown in your responses.
`,
  };
}
