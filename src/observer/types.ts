import { Logger } from "@nestjs/common";
import { type Observable, Subject } from "rxjs";

export interface ObserverFactory {
  /**
   * @param botMemberId identity from members API; in the wire form of creator/mention param this is
   *                    "_participant_<spaceId>_<identity>" — matched by suffix.
   */
  create(id: string, botName: string, botMemberId: string): AbstractObserver;
}

export abstract class AbstractObserver {
  protected readonly logger = new Logger(this.constructor.name);
  protected readonly destroy$ = new Subject<void>();

  /**
   * Actor lifecycle: next — heartbeat on every sent reply;
   * error — fatal error (space shutdown policy on the service side);
   * complete — graceful shutdown via destroy().
   */
  abstract run(): Observable<unknown>;

  public destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
