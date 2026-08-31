import { mock } from "bun:test";
import { type Observable, of } from "rxjs";
import type { ChatMessagePayload } from "../../client/types";
import type { AbstractObserver } from "../types";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeout = 3000,
  poll = 10,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await sleep(poll);
  }
  if (!(await predicate())) {
    throw new Error(`waitFor timed out after ${timeout}ms`);
  }
}

export function makeMessage(
  overrides: Partial<ChatMessagePayload> = {},
  opts: { mentionBot?: string; replyTo?: string } = {},
): ChatMessagePayload {
  const msg: ChatMessagePayload = {
    id: `msg_${Math.random().toString(36).substring(2, 9)}`,
    order_id: "0",
    creator: "usr_alice",
    creator_name: "Alice",
    // Wire format of created_at is in SECONDS (proof: spike logs 1788106711)
    created_at: Math.floor(Date.now() / 1000),
    modified_at: Math.floor(Date.now() / 1000),
    content: {
      text: "Hello",
      style: "paragraph",
    },
    attachments: [],
    reactions: null,
    pinned: false,
    ...overrides,
  };

  // Wire format of mention: "_participant_<...>_<identity>" — isBotId matches by suffix
  if (opts.mentionBot) {
    msg.content = {
      ...msg.content,
      marks: [
        ...(msg.content.marks ?? []),
        { type: "mention", param: `_participant_space_${opts.mentionBot}` },
      ],
    };
  }
  if (opts.replyTo) {
    msg.reply_to_message_id = opts.replyTo;
  }
  return msg;
}

export interface ObserverServiceInternals {
  checkSpaces: () => Promise<void>;
  registry: Map<string, AbstractObserver[]>;
  lastActivity: Map<string, number>;
}

export function makeFakeObserver(
  run$: Observable<void> = of(undefined),
  destroySpy: () => void = mock(() => {}),
): AbstractObserver {
  return {
    run: mock(() => run$),
    destroy: destroySpy,
  } as unknown as AbstractObserver;
}

export function callCount(fn: unknown): number {
  return (fn as { mock: { calls: unknown[] } }).mock.calls.length;
}

export function callArg<T>(fn: unknown, callIndex = 0, argIndex = 0): T {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls[callIndex]?.[argIndex] as T;
}

export function extractSpaceId(url: string): string {
  return decodeURIComponent(url.split("/spaces/")[1]?.split("/")[0] || "");
}

export function extractChatId(url: string): string {
  return decodeURIComponent(url.split("/chats/")[1]?.split("/")[0] || "");
}
