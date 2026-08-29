import { Logger } from "@nestjs/common";
import { type Observable, Subject } from "rxjs";

export type AgentEvent = any;

export interface ObserverFactory {
  create(id: string, botName: string): AbstractObserver;
}

export abstract class AbstractObserver {
  protected readonly logger = new Logger(this.constructor.name);
  protected readonly destroy$ = new Subject<void>();

  /**
   * Жизненный цикл актора:
   *  next     — один удар на каждый отправленный ответ бота (heartbeat)
   *  error    — фатальная смерть обсервера; политика (гасить спейс) — на стороне сервиса
   *  complete — плановое выключение через destroy()
   */
  abstract run(): Observable<unknown>;

  public destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
