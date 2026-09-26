import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTrace } from './schema.js';

const dir = new URL('../samples/', import.meta.url);
const samples = readdirSync(dir)
  .filter((name) => name.endsWith('.json'))
  .map((name) => ({
    name,
    trace: parseTrace(JSON.parse(readFileSync(new URL(name, dir), 'utf8'))),
  }));

describe('committed sample traces', () => {
  it('all parse against the schema', () => {
    expect(samples.length).toBeGreaterThanOrEqual(5);
  });

  it('cover both front doors and every failure behaviour', () => {
    const doors = new Set(samples.map((s) => s.trace.front_door));
    const fhIds = new Set(samples.flatMap((s) => s.trace.events.map((e) => e.fh.id)));
    expect([...doors].sort()).toEqual(['connect', 'softphone']);
    expect([...fhIds].sort()).toEqual(['FH-01', 'FH-03', 'FH-05', 'FH-10']);
  });
});
