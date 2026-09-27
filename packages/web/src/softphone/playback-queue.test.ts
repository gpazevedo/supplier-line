import { expect, it } from 'vitest';
import { PlaybackQueue } from './playback-queue.js';

const RATE = 1000;
const samples = (n: number, value = 0.5) => new Float32Array(n).fill(value);

it('plays chunks in order and counts played milliseconds per turn', () => {
  const queue = new PlaybackQueue(RATE);
  queue.push(0, samples(3, 0.1));
  queue.push(1, samples(3, 0.2));
  const out = new Float32Array(4);
  queue.pull(out);
  expect([...out].map((v) => v.toFixed(1))).toEqual(['0.1', '0.1', '0.1', '0.2']);
  expect(queue.playedMs(0)).toBe(3);
  expect(queue.playedMs(1)).toBe(1);
});

it('pads with silence when empty and counts only real audio', () => {
  const queue = new PlaybackQueue(RATE);
  queue.push(0, samples(2));
  const out = new Float32Array(5).fill(9);
  queue.pull(out);
  expect([...out]).toEqual([0.5, 0.5, 0, 0, 0]);
  expect(queue.playedMs(0)).toBe(2);
  expect(queue.queuedMs()).toBe(0);
});

it('drops queued audio on flush, keeping what already played', () => {
  const queue = new PlaybackQueue(RATE);
  queue.push(0, samples(10));
  queue.pull(new Float32Array(4));
  queue.flush();
  queue.pull(new Float32Array(4));
  expect(queue.playedMs(0)).toBe(4);
  expect(queue.queuedMs()).toBe(0);
});

it('reports zero for a turn it never played', () => {
  expect(new PlaybackQueue(RATE).playedMs(7)).toBe(0);
});

it('lists each turn whose played total changed since the last call', () => {
  const queue = new PlaybackQueue(RATE);
  queue.push(0, samples(2));
  queue.push(1, samples(5));
  queue.pull(new Float32Array(4));
  expect(queue.changedTurns()).toEqual([
    { turn: 0, ms: 2 },
    { turn: 1, ms: 2 },
  ]);
  expect(queue.changedTurns()).toEqual([]);
  queue.pull(new Float32Array(1));
  expect(queue.changedTurns()).toEqual([{ turn: 1, ms: 3 }]);
});
