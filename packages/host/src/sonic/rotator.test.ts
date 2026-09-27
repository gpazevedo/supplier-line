import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HistoryMessage } from './history.js';
import { Rotator, type RotatingConnection, type RotationStats } from './rotator.js';

const FINAL = '{"generationStage":"FINAL"}';
const SPECULATIVE = '{"generationStage":"SPECULATIVE"}';
const options = { thresholdMs: 60_000, bufferMs: 3000, audioStartTimeoutMs: 20_000 };
const HISTORY: HistoryMessage[] = [{ role: 'USER', text: 'Status?' }];

class FakeConnection implements RotatingConnection {
  private readonly ready = Promise.withResolvers<undefined>();
  readonly opened = this.ready.promise;
  resumedWith?: HistoryMessage[];
  audio: Buffer[] = [];
  closed = false;
  accepting = true;

  resume(history: HistoryMessage[]): void {
    this.resumedWith = history;
  }
  sendAudio(pcm: Buffer): boolean {
    if (this.accepting) this.audio.push(pcm);
    return this.accepting;
  }
  close(): void {
    this.closed = true;
  }
  open(): void {
    this.ready.resolve(undefined);
  }
  fail(): void {
    this.ready.reject(new Error('open failed'));
  }
}

/** One second of 16 kHz 16-bit caller audio whose first byte tags it. */
const second = (tag: number) => Buffer.alloc(32_000, tag);

let first: FakeConnection;
let opened: FakeConnection[];
let rotated: RotationStats[];
let rotator: Rotator<FakeConnection>;

beforeEach(() => {
  vi.useFakeTimers();
  first = new FakeConnection();
  opened = [];
  rotated = [];
  rotator = new Rotator(
    first,
    {
      open: () => {
        const next = new FakeConnection();
        opened.push(next);
        return next;
      },
      history: () => HISTORY,
      rotated: (stats) => rotated.push(stats),
    },
    options
  );
});

afterEach(() => {
  rotator.close();
  vi.useRealTimers();
});

function speak(conn: FakeConnection, id: string, content: string) {
  const ev = (name: string, body: Record<string, unknown>) => rotator.onOutput(conn, name, body);
  ev('contentStart', {
    contentId: `${id}s`,
    type: 'TEXT',
    role: 'ASSISTANT',
    additionalModelFields: SPECULATIVE,
  });
  ev('textOutput', { contentId: `${id}s`, content });
  ev('contentStart', { contentId: `${id}a`, type: 'AUDIO', role: 'ASSISTANT' });
  return () => {
    ev('contentStart', {
      contentId: `${id}f`,
      type: 'TEXT',
      role: 'ASSISTANT',
      additionalModelFields: FINAL,
    });
    ev('textOutput', { contentId: `${id}f`, content });
  };
}

it('does not open a new connection before the threshold, even while the agent speaks', () => {
  vi.advanceTimersByTime(59_000);
  speak(first, 'r1', 'Hello.')();
  expect(opened).toHaveLength(0);
  expect(rotator.current).toBe(first);
});

it('after the threshold, opens the next connection once the agent starts speaking', () => {
  vi.advanceTimersByTime(60_000);
  expect(opened).toHaveLength(0);
  speak(first, 'r1', 'Purchase order.');
  expect(opened).toHaveLength(1);
  expect(rotator.current).toBe(first);
});

it('hands over when the response completes: history, last 3 s of caller audio, then closes the old', async () => {
  vi.advanceTimersByTime(60_000);
  const finish = speak(first, 'r1', 'Purchase order.');
  const next = opened[0];
  next.open();
  [1, 2, 3, 4].forEach((tag) => rotator.audio(second(tag)));
  expect(first.audio.map((b) => b[0])).toEqual([1, 2, 3, 4]);
  vi.advanceTimersByTime(250);
  finish();
  await vi.advanceTimersByTimeAsync(0);

  expect(next.resumedWith).toEqual(HISTORY);
  expect(next.audio.map((b) => b[0])).toEqual([2, 3, 4]);
  expect(first.closed).toBe(true);
  expect(rotator.current).toBe(next);
  expect(rotated).toEqual([{ gapMs: 0, audioInMs: 4000, audioForwardedMs: 4000 }]);

  rotator.audio(second(5));
  expect(next.audio.map((b) => b[0])).toEqual([2, 3, 4, 5]);
  expect(first.audio).toHaveLength(4);
});

it('waits for the next connection to open, keeps feeding the old one, and reports the gap', async () => {
  vi.advanceTimersByTime(60_000);
  speak(first, 'r1', 'Purchase order.')();
  const next = opened[0];
  rotator.audio(second(1));
  await vi.advanceTimersByTimeAsync(400);
  expect(rotator.current).toBe(first);
  rotator.audio(second(2));
  next.open();
  await vi.advanceTimersByTimeAsync(0);

  expect(rotator.current).toBe(next);
  expect(first.audio.map((b) => b[0])).toEqual([1, 2]);
  expect(next.audio.map((b) => b[0])).toEqual([1, 2]);
  expect(rotated).toEqual([{ gapMs: 400, audioInMs: 2000, audioForwardedMs: 2000 }]);
});

it('hands over on an interrupted response', async () => {
  vi.advanceTimersByTime(60_000);
  speak(first, 'r1', 'Purchase order.');
  opened[0].open();
  rotator.onOutput(first, 'contentEnd', { type: 'TEXT', stopReason: 'INTERRUPTED' });
  await vi.advanceTimersByTimeAsync(0);
  expect(rotator.current).toBe(opened[0]);
});

it('forces the transition when the agent stays silent past the timeout, handing over at once', async () => {
  vi.advanceTimersByTime(60_000 + 20_000);
  expect(opened).toHaveLength(1);
  opened[0].open();
  await vi.advanceTimersByTimeAsync(0);
  expect(rotator.current).toBe(opened[0]);
});

it('counts caller audio the old connection refused and the buffer did not carry as lost', async () => {
  vi.advanceTimersByTime(60_000);
  const finish = speak(first, 'r1', 'Purchase order.');
  first.accepting = false;
  [1, 2, 3, 4, 5].forEach((tag) => rotator.audio(second(tag)));
  opened[0].open();
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(rotated).toEqual([{ gapMs: 0, audioInMs: 5000, audioForwardedMs: 3000 }]);
});

it('ignores output from a connection that is no longer current', async () => {
  vi.advanceTimersByTime(60_000);
  speak(first, 'r1', 'Purchase order.')();
  opened[0].open();
  await vi.advanceTimersByTimeAsync(0);
  vi.advanceTimersByTime(60_000);
  speak(first, 'r2', 'Stale.');
  expect(opened).toHaveLength(1);
});

it('rotates again a full threshold after the handoff', async () => {
  vi.advanceTimersByTime(60_000);
  speak(first, 'r1', 'One.')();
  opened[0].open();
  await vi.advanceTimersByTimeAsync(0);
  vi.advanceTimersByTime(59_000);
  speak(opened[0], 'r2', 'Two.')();
  expect(opened).toHaveLength(1);
  vi.advanceTimersByTime(1000);
  speak(opened[0], 'r3', 'Three.')();
  opened[1].open();
  await vi.advanceTimersByTimeAsync(0);
  expect(rotator.current).toBe(opened[1]);
  expect(opened[0].closed).toBe(true);
  expect(rotated).toHaveLength(2);
});

it('drops a next connection that fails to open and retries on the next response', async () => {
  vi.advanceTimersByTime(60_000);
  speak(first, 'r1', 'One.')();
  opened[0].fail();
  await vi.advanceTimersByTimeAsync(0);
  expect(rotator.current).toBe(first);
  speak(first, 'r2', 'Two.')();
  expect(opened).toHaveLength(2);
});

it('closes both connections when the call ends mid-transition', () => {
  vi.advanceTimersByTime(60_000);
  speak(first, 'r1', 'One.');
  rotator.close();
  expect(first.closed).toBe(true);
  expect(opened[0].closed).toBe(true);
});

it('does not hand over on a "Go on" while a tool call waits for its spoken rendering', async () => {
  vi.advanceTimersByTime(60_000);
  rotator.onOutput(first, 'toolUse', { toolName: 'get_po_status' });
  rotator.onToolResult(first, 'Purchase order shipped.');
  speak(first, 'r1', 'Go on')();
  opened[0].open();
  await vi.advanceTimersByTimeAsync(0);
  expect(rotator.current).toBe(first);
  speak(first, 'r2', 'Purchase order shipped.')();
  await vi.advanceTimersByTimeAsync(0);
  expect(rotator.current).toBe(opened[0]);
});
