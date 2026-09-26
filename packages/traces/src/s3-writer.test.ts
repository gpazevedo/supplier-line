import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { parseTrace } from './schema.js';
import { s3TraceWriter, tracesBucket } from './s3-writer.js';

const trace = parseTrace({
  session_id: 'sess-1',
  front_door: 'connect',
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

const fakeClient = () => {
  const send = vi.fn().mockResolvedValue({});
  return { client: { send } as unknown as S3Client, send };
};

describe('tracesBucket', () => {
  it('names the bucket after the account', () => {
    expect(tracesBucket('123456789012')).toBe('supplier-line-traces-123456789012');
  });
});

describe('s3TraceWriter', () => {
  it('puts <session_id>.json as JSON into the bucket and returns its S3 URI', async () => {
    const { client, send } = fakeClient();
    const location = await s3TraceWriter(client, 'supplier-line-traces-123456789012').write(trace);

    expect(location).toBe('s3://supplier-line-traces-123456789012/sess-1.json');
    const command = send.mock.calls[0][0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'supplier-line-traces-123456789012',
      Key: 'sess-1.json',
      ContentType: 'application/json',
    });
    expect(parseTrace(JSON.parse(command.input.Body as string))).toEqual(trace);
  });

  it('refuses an invalid trace and sends nothing', async () => {
    const { client, send } = fakeClient();
    const broken = { ...trace, front_door: 'fax' } as unknown as typeof trace;
    await expect(s3TraceWriter(client, 'bucket').write(broken)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
