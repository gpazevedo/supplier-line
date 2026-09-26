import { mkdtempSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkTraces } from './check-traces.js';

const samples = new URL('../samples/', import.meta.url).pathname;
const broken = new URL('../test-fixtures/broken/', import.meta.url).pathname;

describe('checkTraces', () => {
  it('passes the committed samples', () => {
    const result = checkTraces([samples]);
    expect(result.ok).toBe(true);
    expect(result.report).toContain('7 traces, 0 failed');
  });

  it('fails with per-trace, per-check output for a broken trace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'traces-'));
    copyFileSync(join(broken, 'slow-flush.json'), join(dir, 'slow-flush.json'));
    const result = checkTraces([dir]);
    expect(result.ok).toBe(false);
    expect(result.report).toContain('FAIL slow-flush.json');
    expect(result.report).toContain('fast-flush');
    expect(result.report).toContain('turn 0');
  });

  it('reports a schema-invalid trace as a failure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'traces-'));
    writeFileSync(join(dir, 'bad.json'), '{"session_id": ""}');
    const result = checkTraces([dir]);
    expect(result.ok).toBe(false);
    expect(result.report).toContain('FAIL bad.json');
    expect(result.report).toContain('schema');
  });

  it('ignores a directory that does not exist', () => {
    expect(checkTraces([join(tmpdir(), 'no-such-traces-dir')]).ok).toBe(true);
  });
});
