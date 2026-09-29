import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FillerTimer } from './filler-timer.js';

const STALL_MS = 1500;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function timerFor(turn: { index: number | undefined }) {
  const onFire = vi.fn();
  return { onFire, timer: new FillerTimer(STALL_MS, { onFire, currentTurn: () => turn.index }) };
}

describe('FillerTimer (FH-03)', () => {
  it('fires once the stall window elapses after the caller stops speaking', () => {
    const { onFire, timer } = timerFor({ index: 0 });
    timer.speechEnded();
    vi.advanceTimersByTime(STALL_MS - 1);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFire).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('never fires while the caller is still speaking, however long the pause mid-code', () => {
    // Live: the filler fired 1.5 s after "p o one?", in the caller's pause before "zero four
    // eight two?", because the clock restarted on every transcript segment.
    const { onFire, timer } = timerFor({ index: 0 });
    timer.speechStarted();
    vi.advanceTimersByTime(STALL_MS * 3);
    expect(onFire).not.toHaveBeenCalled();
  });

  it('never fires once agent audio starts before the stall window', () => {
    const { onFire, timer } = timerFor({ index: 0 });
    timer.speechEnded();
    vi.advanceTimersByTime(STALL_MS - 1);
    timer.audio();
    vi.advanceTimersByTime(10_000);
    expect(onFire).not.toHaveBeenCalled();
  });

  it('stops the clock when the caller speaks again, and restarts it when they stop', () => {
    const { onFire, timer } = timerFor({ index: 0 });
    timer.speechEnded();
    vi.advanceTimersByTime(1000);
    timer.speechStarted();
    vi.advanceTimersByTime(STALL_MS * 2);
    expect(onFire).not.toHaveBeenCalled();
    timer.speechEnded();
    vi.advanceTimersByTime(STALL_MS);
    expect(onFire).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('fires for the turn in progress when it fires, not when the caller stopped', () => {
    // Sonic can report the end of speech before the transcript that opens the new turn.
    const turn = { index: 0 as number | undefined };
    const { onFire, timer } = timerFor(turn);
    timer.speechEnded();
    turn.index = 1;
    vi.advanceTimersByTime(STALL_MS);
    expect(onFire).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('fires at most once per turn', () => {
    const { onFire, timer } = timerFor({ index: 0 });
    timer.speechEnded();
    vi.advanceTimersByTime(STALL_MS);
    timer.speechEnded();
    vi.advanceTimersByTime(STALL_MS * 2);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('does not fire before the caller has a turn', () => {
    const { onFire, timer } = timerFor({ index: undefined });
    timer.speechEnded();
    vi.advanceTimersByTime(STALL_MS);
    expect(onFire).not.toHaveBeenCalled();
  });

  it('stop drops a pending timer and ignores every later call', () => {
    const { onFire, timer } = timerFor({ index: 0 });
    timer.speechEnded();
    timer.stop();
    vi.advanceTimersByTime(STALL_MS * 2);
    timer.speechEnded();
    vi.advanceTimersByTime(STALL_MS * 2);
    expect(onFire).not.toHaveBeenCalled();
  });
});
