import { Logger } from "@nestjs/common";
import type { Observable } from "rxjs";
export abstract class AbstractLlmService {
  protected readonly logger = new Logger(this.constructor.name);

  /**
   * Инициализация провайдера (SSH, ключи, CLI) при старте — быстрый фейл битого конфига.
   */
  abstract init(): Promise<void>;

  /**
   * Инвариант стрима: ровно один LlmResponse, он — последний элемент, затем complete.
   * Промежуточные события — LlmAction (прогресс); ошибки летят через error-канал.
   */
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
