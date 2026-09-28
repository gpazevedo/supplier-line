import { describe, expect, it } from 'vitest';
import type { Trace } from 'traces/src/index.js';
import { rotationCheck } from './rotation-check.js';

const trace = (events: Trace['events']): Trace => ({
  session_id: 's',
  front_door: 'softphone',
  started_at: '2026-09-27T10:00:00.000Z',
  turns: [],
  events,
});

const rotation = {
  fh: { id: 'FH-05' as const },
  at_ms: 361_000,
  rotation: { audio_in_ms: 3000, audio_forwarded_ms: 3000, gap_ms: 120 },
};

describe('rotationCheck', () => {
  it('passes a trace with at least one FH-05 handover', () => {
    expect(rotationCheck(trace([rotation]))).toEqual({ pass: true, detail: '1 rotation' });
  });

  it('fails a trace with no rotation, so a too-short live scenario cannot pass', () => {
    expect(rotationCheck(trace([{ fh: { id: 'FH-03' }, at_ms: 10 }])).pass).toBe(false);
  });

  it('fails when no trace came back', () => {
    expect(rotationCheck(undefined)).toEqual({ pass: false, detail: 'no trace returned' });
  });
});
