import type { AgentEvent } from "../observer/types";

export abstract class AbstractLlmService {
  /**
   * Инициализация и проверка доступности LLM провайдера (SSH, API-ключи, CLI).
   * Вызывается при старте приложения для быстрого падения при ошибках конфигурации.
   */
  abstract init(): Promise<void>;

  /**
   * Генерация текстового ответа на событие от обсервера.
   */
  abstract generateResponse(event: AgentEvent): Promise<string>;
}
