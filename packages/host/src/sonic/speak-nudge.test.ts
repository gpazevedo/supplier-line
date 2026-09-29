import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SpeakNudge } from './speak-nudge.js';

const DELAY_MS = 3000;
const RENDERING = 'Purchase order one zero four eight two from Summit Fasteners has shipped.';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function nudger() {
  const nudge = vi.fn();
  return { nudge, speak: new SpeakNudge(DELAY_MS, { nudge }) };
}

it('nudges once when Sonic ends its response without speaking a returned result', () => {
  // Live follow-up-delivery: "Let me check that." then 12 s of silence until the caller asked again.
  const { nudge, speak } = nudger();
  speak.toolResult(0, RENDERING);
  speak.assistantText('Let me check that.');
  speak.responseEnded();
  vi.advanceTimersByTime(DELAY_MS - 1);
  expect(nudge).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(nudge).toHaveBeenCalledExactlyOnceWith(0);

  speak.responseEnded();
  vi.advanceTimersByTime(DELAY_MS * 2);
  expect(nudge).toHaveBeenCalledTimes(1);
});

it('does not nudge once the rendering starts', () => {
  const { nudge, speak } = nudger();
  speak.toolResult(0, RENDERING);
  speak.responseEnded();
  speak.assistantText(RENDERING);
  speak.responseEnded();
  vi.advanceTimersByTime(DELAY_MS * 2);
  expect(nudge).not.toHaveBeenCalled();
});

it('waits while Sonic is still speaking', () => {
  const { nudge, speak } = nudger();
  speak.toolResult(0, RENDERING);
  vi.advanceTimersByTime(DELAY_MS - 10);
  speak.assistantText('Let me check that.');
  vi.advanceTimersByTime(DELAY_MS * 2);
  expect(nudge).not.toHaveBeenCalled();
});

it('nudges when the result arrives after Sonic has gone quiet', () => {
  const { nudge, speak } = nudger();
  speak.assistantText('Let me check that.');
  speak.responseEnded();
  speak.toolResult(0, RENDERING);
  vi.advanceTimersByTime(DELAY_MS);
  expect(nudge).toHaveBeenCalledExactlyOnceWith(0);
});

it('does not nudge once the caller speaks again', () => {
  const { nudge, speak } = nudger();
  speak.toolResult(0, RENDERING);
  speak.responseEnded();
  speak.callerSpoke();
  vi.advanceTimersByTime(DELAY_MS * 2);
  expect(nudge).not.toHaveBeenCalled();
});

it('stop drops a pending nudge', () => {
  const { nudge, speak } = nudger();
  speak.toolResult(0, RENDERING);
  speak.responseEnded();
  speak.stop();
  vi.advanceTimersByTime(DELAY_MS * 2);
  expect(nudge).not.toHaveBeenCalled();
});
