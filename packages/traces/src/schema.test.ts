import { describe, expect, it } from 'vitest';
import { parseTrace } from './schema.js';

const turn = {
  index: 0,
  latency: { voice_to_voice_ms: 900 },
  audio: { planned_ms: 4000, delivered_ms: 4000, played_ms: 3900 },
  assistant: { final_text: 'Purchase order 1 2 3 is shipped.' },
};

const trace = {
  session_id: 'sess-1',
  front_door: 'softphone',
  started_at: '2026-09-26T10:00:00.000Z',
  turns: [turn],
  events: [],
};

describe('parseTrace', () => {
  it('accepts a minimal softphone trace', () => {
    expect(parseTrace(trace).front_door).toBe('softphone');
  });

  it('keeps barge-in, flush latency, filler and the tool call with its rendering', () => {
    const full = {
      ...turn,
      audio: { ...turn.audio, flush_latency_ms: 120 },
      bargein: { at_ms: 2500 },
      filler: { played: true },
      tool: { name: 'get_po_status', rendering: 'shipped, due March 3rd' },
    };
    const parsed = parseTrace({ ...trace, turns: [full] });
    expect(parsed.turns[0]).toEqual(full);
  });

  it('accepts a Connect turn that has no audio ledger', () => {
    const { audio: _audio, ...connectTurn } = turn;
    expect(parseTrace({ ...trace, front_door: 'connect', turns: [connectTurn] }).turns).toEqual([
      connectTurn,
    ]);
  });

  it('keeps failure events and the rotation fields of an FH-05 handoff', () => {
    const events = [
      { fh: { id: 'FH-01' }, at_ms: 10 },
      { fh: { id: 'FH-03' }, at_ms: 1500, turn: 0 },
      { fh: { id: 'FH-10' }, at_ms: 3000, turn: 1 },
      {
        fh: { id: 'FH-05' },
        at_ms: 360000,
        rotation: { audio_in_ms: 5000, audio_forwarded_ms: 5000, gap_ms: 180 },
      },
    ];
    expect(parseTrace({ ...trace, events }).events).toEqual(events);
  });

  it('rejects an FH-05 event without rotation fields', () => {
    const events = [{ fh: { id: 'FH-05' }, at_ms: 360000 }];
    expect(() => parseTrace({ ...trace, events })).toThrow(/rotation/);
  });

  it('rejects failure behaviours that are out of scope', () => {
    const events = [{ fh: { id: 'FH-02' }, at_ms: 10 }];
    expect(() => parseTrace({ ...trace, events })).toThrow();
  });

  it.each([
    ['unknown front door', { front_door: 'fax' }],
    ['non-ISO start time', { started_at: 'yesterday' }],
    ['turn without latency', { turns: [{ ...turn, latency: undefined }] }],
    ['negative played_ms', { turns: [{ ...turn, audio: { ...turn.audio, played_ms: -1 } }] }],
  ])('rejects %s', (_name, patch) => {
    expect(() => parseTrace({ ...trace, ...patch })).toThrow();
  });
});
