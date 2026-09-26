import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTrace } from '../schema.js';
import { runChecks } from './index.js';

const load = (dir: URL, name: string) =>
  parseTrace(JSON.parse(readFileSync(new URL(name, dir), 'utf8')));

const samplesDir = new URL('../../samples/', import.meta.url);
const brokenDir = new URL('../../test-fixtures/broken/', import.meta.url);

describe('good samples', () => {
  it.each(readdirSync(samplesDir))('%s passes every check', (name) => {
    expect(runChecks(load(samplesDir, name))).toEqual([]);
  });
});

describe('broken traces', () => {
  it.each([
    ['heard-exceeds-generated', 'heard-le-generated'],
    ['slow-flush', 'fast-flush'],
    ['missing-rendering', 'exact-rendering'],
    ['dead-air', 'no-dead-air'],
    ['rotation-loses-audio', 'rotation-loses-nothing'],
  ])('%s fails only %s', (fixture, check) => {
    const failures = runChecks(load(brokenDir, `${fixture}.json`));
    expect(failures.map((f) => f.check)).toEqual([check]);
  });
});

describe('turns without an audio ledger (Connect)', () => {
  it('skip the audio-based checks, even with slow first audio', () => {
    const trace = load(samplesDir, 'connect-happy.json');
    trace.turns[0].latency.voice_to_voice_ms = 9000;
    expect(runChecks(trace)).toEqual([]);
  });
});

describe('fast flush', () => {
  it('fails a barge-in that recorded no flush latency', () => {
    const trace = load(samplesDir, 'softphone-bargein.json');
    trace.turns[0].audio = { planned_ms: 6000, delivered_ms: 3100, played_ms: 2800 };
    expect(runChecks(trace).map((f) => f.check)).toEqual(['fast-flush']);
  });
});
