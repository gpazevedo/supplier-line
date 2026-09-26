export type Sleep = (ms: number) => Promise<void>;

/** Fault-injection hook (FH-10): wait `delayMs` before answering. Off unless `delayMs` is set. */
export interface DelayOptions {
  delayMs?: number;
  /** Injectable for tests and fake clocks; defaults to a real timer. */
  sleep?: Sleep;
}

const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function applyDelay({ delayMs, sleep = realSleep }: DelayOptions): Promise<void> {
  if (delayMs) await sleep(delayMs);
}
