import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localTraceWriter } from './local-writer.js';
import { parseTrace } from './schema.js';

const trace = parseTrace({
  session_id: 'sess-1',
  front_door: 'softphone',
  started_at: '2026-09-26T10:00:00.000Z',
  turns: [
    {
      index: 0,
      latency: { voice_to_voice_ms: 900 },
      audio: { planned_ms: 4000, delivered_ms: 4000, played_ms: 3900 },
      assistant: { final_text: 'Hello.' },
    },
  ],
  events: [],
});

describe('localTraceWriter', () => {
  it('writes <session_id>.json into the folder, creating it if missing', async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'traces-')), 'nested');
    const location = await localTraceWriter(dir).write(trace);
    expect(location).toBe(join(dir, 'sess-1.json'));
    expect(parseTrace(JSON.parse(await readFile(location, 'utf8')))).toEqual(trace);
  });

  it('refuses an invalid trace and writes nothing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'traces-'));
    const broken = { ...trace, front_door: 'fax' } as unknown as typeof trace;
    await expect(localTraceWriter(dir).write(broken)).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });
});
