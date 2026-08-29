import { Logger } from "@nestjs/common";
import type { Observable } from "rxjs";
export abstract class AbstractLlmService {
  protected readonly logger = new Logger(this.constructor.name);

  /**
   * Инициализация и проверка доступности LLM провайдера (SSH, API-ключи, CLI).
   * Вызывается при старте приложения для быстрого падения при ошибках конфигурации.
   */
  abstract init(): Promise<void>;

  abstract run(spaceId: string, payload: object): Observable<LlmEvent>;
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
