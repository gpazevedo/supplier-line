import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import type { Trace } from 'traces/src/index.js';
import { afterEach, expect, it } from 'vitest';
import { traceWriter } from './trace-writer.js';

const trace: Trace = {
  session_id: 'session-1',
  front_door: 'softphone',
  started_at: '2026-09-27T10:00:00.000Z',
  turns: [],
  events: [],
};

const s3 = mockClient(S3Client);
afterEach(() => s3.reset());

it('puts traces in the bucket named by TRACES_BUCKET, as in AWS', async () => {
  s3.on(PutObjectCommand).resolves({});
  const location = await traceWriter({ TRACES_BUCKET: 'supplier-line-traces-1' }).write(trace);
  expect(location).toBe('s3://supplier-line-traces-1/session-1.json');
  expect(s3.commandCalls(PutObjectCommand)[0].args[0].input).toMatchObject({
    Bucket: 'supplier-line-traces-1',
    Key: 'session-1.json',
  });
});

it('writes traces to TRACE_DIR when no bucket is set, as locally', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'host-traces-'));
  const location = await traceWriter({ TRACE_DIR: dir }).write(trace);
  expect(location).toBe(join(dir, 'session-1.json'));
  expect(JSON.parse(readFileSync(location, 'utf8')).session_id).toBe('session-1');
  expect(s3.calls()).toHaveLength(0);
});
