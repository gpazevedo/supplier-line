export type Sleep = (ms: number) => Promise<void>;

const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

type Attempt<T> = { ok: true; value: T } | { ok: false };

/** Races `run()` against a timeout; a rejection counts the same as timing out. */
async function attempt<T>(
  run: () => Promise<T>,
  timeoutMs: number,
  sleep: Sleep
): Promise<Attempt<T>> {
  const task = run()
    .then((value): Attempt<T> => ({ ok: true, value }))
    .catch((): Attempt<T> => ({ ok: false }));
  const timeout = sleep(timeoutMs).then((): Attempt<T> => ({ ok: false }));
  return Promise.race([task, timeout]);
}

export interface ToolCallOutcome {
  content: string;
  timedOut: boolean;
}

/**
 * Runs `run` with a timeout (FH-10): if it hasn't answered within `timeoutMs`, calls `onTimeout`
 * and retries once. Whatever the first attempt eventually returns after that point is discarded,
 * even if it resolves later. If the retry also fails to answer in time, returns `onExhausted()`'s
 * content instead.
 */
export async function callWithTimeout(
  run: () => Promise<string>,
  timeoutMs: number,
  onTimeout: () => void,
  onExhausted: () => string,
  sleep: Sleep = realSleep
): Promise<ToolCallOutcome> {
  const first = await attempt(run, timeoutMs, sleep);
  if (first.ok) return { content: first.value, timedOut: false };
  onTimeout();
  const retry = await attempt(run, timeoutMs, sleep);
  return retry.ok
    ? { content: retry.value, timedOut: true }
    : { content: onExhausted(), timedOut: true };
}
