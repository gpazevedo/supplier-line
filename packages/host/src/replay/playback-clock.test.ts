import { expect, it } from 'vitest';
import { PlaybackClock } from './playback-clock.js';

const oneSecond = 24_000 * 2;

it('queues audio back to back from when it first arrives', () => {
  const clock = new PlaybackClock(24_000);
  clock.add(oneSecond, 1000);
  clock.add(oneSecond, 1200);
  expect(clock.endsAt).toBe(3000);
});

it('restarts from arrival time after a gap', () => {
  const clock = new PlaybackClock(24_000);
  clock.add(oneSecond, 1000);
  clock.add(oneSecond, 5000);
  expect(clock.endsAt).toBe(6000);
});

it('is idle when nothing has played yet', () => {
  expect(new PlaybackClock(24_000).endsAt).toBe(0);
});
