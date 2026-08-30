import { Logger } from "@nestjs/common";
import { type Observable, Subject } from "rxjs";

export type AgentEvent = any;

export interface ObserverFactory {
  /**
   * @param botMemberId identity из members API; в wire-форме creator/mention param это
   *                    "_participant_<spaceId>_<identity>" — матч по суффиксу.
   */
  create(id: string, botName: string, botMemberId: string): AbstractObserver;
}

export abstract class AbstractObserver {
  protected readonly logger = new Logger(this.constructor.name);
  protected readonly destroy$ = new Subject<void>();

  /**
   * Жизненный цикл актора: next — heartbeat на каждый отправленный ответ;
   * error — фатал (политика гашения спейса на стороне сервиса);
   * complete — плановое выключение через destroy().
   */
  abstract run(): Observable<unknown>;

  public destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
