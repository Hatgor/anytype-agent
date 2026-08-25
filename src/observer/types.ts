import { Logger } from "@nestjs/common";
import { Subject } from "rxjs";

export type AgentEvent = any;

export interface ObserverFactory {
  create(id: string, botName: string): AbstractObserver;
}

export abstract class AbstractObserver {
  protected readonly logger = new Logger(this.constructor.name);
  protected readonly destroy$ = new Subject<void>();

  protected readonly events$ = new Subject<AgentEvent>();
  public readonly events = this.events$.asObservable();

  public destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
