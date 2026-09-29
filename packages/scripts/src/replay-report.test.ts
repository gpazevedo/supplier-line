import { mkdtempSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkTraces } from 'traces/src/check-traces.js';
import { writeReplayReport } from './replay-report.js';

const sample = new URL('../../traces/samples/softphone-happy.json', import.meta.url);

describe('writeReplayReport', () => {
  it('writes a pass/fail line per scenario', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'replay-'));
    const path = await writeReplayReport(dir, [
      { name: 'po-status-a', pass: true },
      { name: 'barge-in', pass: false },
    ]);
    expect(readFileSync(path, 'utf8')).toBe('PASS po-status-a\nFAIL barge-in\n');
  });

  it('leaves the out directory checkable as traces, as the live smoke job does', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'replay-'));
    copyFileSync(sample, join(dir, 'po-status-a.trace.json'));
    await writeReplayReport(dir, [{ name: 'po-status-a', pass: true }]);
    const result = checkTraces([dir], { requireTraces: true });
    expect(result.report).toBe('1 traces, 0 failed');
  });
});
