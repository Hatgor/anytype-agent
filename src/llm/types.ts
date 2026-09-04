import { Logger } from "@nestjs/common";
import type { Observable } from "rxjs";
export abstract class AbstractLlmService {
  protected readonly logger = new Logger(this.constructor.name);

  /**
   * Provider initialization (SSH, keys, CLI) on startup — fast fail on invalid config.
   */
  abstract init(): Promise<void>;

  /**
   * Stream invariant: exactly one LlmResponse as the final element, followed by complete.
   * Intermediate events are LlmAction (progress); errors are emitted through the error channel.
   */
  abstract run(spaceId: string, payload: object, abort: AbortSignal): Observable<LlmEvent>;
}

export class LlmAction {
  type = "ACT";
  detail = "";

  static create(detail: string): LlmAction {
    return Object.assign(new LlmAction(), { detail });
  }
}

export class LlmResponse {
  type = "RES";
  text = "";

  static create(text: string): LlmResponse {
    return Object.assign(new LlmResponse(), { text });
  }
}

export type LlmEvent = LlmAction | LlmResponse;

export class LlmEmptyResponseError extends Error {
  constructor(message = "Empty response from LLM") {
    super(message);
    this.name = "LlmEmptyResponseError";
  }
}
