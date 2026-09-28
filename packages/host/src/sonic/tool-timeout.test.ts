import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callWithTimeout } from './tool-timeout.js';

const APOLOGY = 'apology content';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('callWithTimeout (FH-10)', () => {
  it('returns the result without a timeout when it answers in time', async () => {
    const onTimeout = vi.fn();
    const run = vi.fn(async () => 'ok content');
    const pending = callWithTimeout(run, 1000, onTimeout, () => APOLOGY);
    await vi.advanceTimersByTimeAsync(0);
    expect(await pending).toEqual({ content: 'ok content', timedOut: false });
    expect(onTimeout).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('fires onTimeout and retries once when the first attempt is slow', async () => {
    const onTimeout = vi.fn();
    let calls = 0;
    const run = vi.fn(() => {
      calls += 1;
      const delay = calls === 1 ? 5000 : 10;
      return new Promise<string>((resolve) => setTimeout(() => resolve(`call-${calls}`), delay));
    });
    const pending = callWithTimeout(run, 1000, onTimeout, () => APOLOGY);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toEqual({ content: 'call-2', timedOut: true });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('discards a stale first result that resolves after the retry has started', async () => {
    const onTimeout = vi.fn();
    let calls = 0;
    const run = vi.fn(() => {
      calls += 1;
      const delay = calls === 1 ? 5000 : 10;
      return new Promise<string>((resolve) => setTimeout(() => resolve(`call-${calls}`), delay));
    });
    const pending = callWithTimeout(run, 1000, onTimeout, () => APOLOGY);
    await vi.advanceTimersByTimeAsync(1010);
    expect(await pending).toEqual({ content: 'call-2', timedOut: true });
    // The stale first call resolves later still; it must never surface as the outcome.
    await vi.advanceTimersByTimeAsync(4000);
    expect(await pending).toEqual({ content: 'call-2', timedOut: true });
  });

  it('sends the apology content when the retry also times out', async () => {
    const onTimeout = vi.fn();
    const run = vi.fn(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('late'), 5000))
    );
    const pending = callWithTimeout(run, 1000, onTimeout, () => APOLOGY);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toEqual({ content: APOLOGY, timedOut: true });
    expect(run).toHaveBeenCalledTimes(2);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('treats a rejection the same as a timeout', async () => {
    const onTimeout = vi.fn();
    let calls = 0;
    const run = vi.fn(() => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('boom'));
      return Promise.resolve('recovered');
    });
    const pending = callWithTimeout(run, 1000, onTimeout, () => APOLOGY);
    expect(await pending).toEqual({ content: 'recovered', timedOut: true });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });
});
