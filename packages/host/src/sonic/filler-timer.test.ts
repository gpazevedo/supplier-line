import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FillerTimer } from './filler-timer.js';

const STALL_MS = 1500;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('FillerTimer (FH-03)', () => {
  it('fires once the stall window elapses with no audio', () => {
    const onFire = vi.fn();
    const timer = new FillerTimer(STALL_MS, { onFire });
    timer.caller(0);
    vi.advanceTimersByTime(STALL_MS - 1);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFire).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('never fires once agent audio starts before the stall window', () => {
    const onFire = vi.fn();
    const timer = new FillerTimer(STALL_MS, { onFire });
    timer.caller(0);
    vi.advanceTimersByTime(STALL_MS - 1);
    timer.audio();
    vi.advanceTimersByTime(10_000);
    expect(onFire).not.toHaveBeenCalled();
  });

  it('resets the clock on a later caller segment in the same turn', () => {
    const onFire = vi.fn();
    const timer = new FillerTimer(STALL_MS, { onFire });
    timer.caller(0);
    vi.advanceTimersByTime(1000);
    timer.caller(0); // caller spoke again before an answer; the stall clock restarts
    vi.advanceTimersByTime(STALL_MS - 1);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFire).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('fires at most once per turn even if the caller keeps talking after it fires', () => {
    const onFire = vi.fn();
    const timer = new FillerTimer(STALL_MS, { onFire });
    timer.caller(0);
    vi.advanceTimersByTime(STALL_MS);
    expect(onFire).toHaveBeenCalledTimes(1);
    timer.caller(0);
    vi.advanceTimersByTime(STALL_MS * 2);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('tracks each turn independently', () => {
    const onFire = vi.fn();
    const timer = new FillerTimer(STALL_MS, { onFire });
    timer.caller(0);
    vi.advanceTimersByTime(STALL_MS);
    expect(onFire).toHaveBeenCalledExactlyOnceWith(0);
    timer.caller(1);
    vi.advanceTimersByTime(STALL_MS);
    expect(onFire).toHaveBeenCalledTimes(2);
    expect(onFire).toHaveBeenLastCalledWith(1);
  });
});
