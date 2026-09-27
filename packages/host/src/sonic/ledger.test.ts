import { expect, it } from 'vitest';
import { PlaybackLedger, SPOKEN_MS_PER_CHAR } from './ledger.js';

const ONE_SECOND = 48_000;

it('records generated and heard for an uninterrupted turn, planned equal to generated', () => {
  const ledger = new PlaybackLedger();
  ledger.planned(0, 'Hello there.');
  ledger.generated(0, ONE_SECOND);
  ledger.generated(0, ONE_SECOND / 2);
  ledger.played(0, 900);
  ledger.played(0, 1500);
  expect(ledger.entry(0)).toEqual({
    audio: { planned_ms: 1500, delivered_ms: 1500, played_ms: 1500 },
  });
});

it('on interruption records the heard cut-off, the flush time and planned from the text', () => {
  const ledger = new PlaybackLedger();
  ledger.planned(0, 'x'.repeat(200));
  ledger.generated(0, 4 * ONE_SECOND);
  ledger.played(0, 1800);
  ledger.interrupted(0, 5050);
  ledger.flushed(0, 1900, 5130);
  expect(ledger.entry(0)).toEqual({
    audio: {
      planned_ms: 200 * SPOKEN_MS_PER_CHAR,
      delivered_ms: 4000,
      played_ms: 1900,
      flush_latency_ms: 80,
    },
    bargein: { at_ms: 1800 },
  });
});

it('never plans less than it generated', () => {
  const ledger = new PlaybackLedger();
  ledger.planned(0, 'Hi.');
  ledger.generated(0, 2 * ONE_SECOND);
  ledger.interrupted(0, 100);
  expect(ledger.entry(0).audio?.planned_ms).toBe(2000);
});

it('keeps turns apart', () => {
  const ledger = new PlaybackLedger();
  ledger.generated(0, ONE_SECOND);
  ledger.generated(1, 2 * ONE_SECOND);
  ledger.played(1, 700);
  expect(ledger.entry(0).audio?.played_ms).toBe(0);
  expect(ledger.entry(1).audio).toMatchObject({ delivered_ms: 2000, played_ms: 700 });
});

it('has no ledger for a turn without agent audio', () => {
  expect(new PlaybackLedger().entry(3)).toEqual({});
});
