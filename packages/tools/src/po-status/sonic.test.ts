import { describe, expect, it } from 'vitest';
import { getPoStatusToolSpec, toolUseToResult } from './sonic';

describe('Sonic tool use adapter', () => {
  it('declares the get_po_status toolSpec with a JSON schema string', () => {
    const { toolSpec } = getPoStatusToolSpec;
    expect(toolSpec.name).toBe('get_po_status');
    expect(toolSpec.description).toMatch(/purchase order/i);
    expect(JSON.parse(toolSpec.inputSchema.json)).toMatchObject({
      type: 'object',
      properties: { po_code: { type: 'string' } },
      required: ['po_code'],
    });
  });

  it('maps toolUse content to a toolResult payload carrying the rendering', async () => {
    const payload = await toolUseToResult('{"po_code":"PO-20931"}');
    const result = JSON.parse(payload);
    expect(result).toMatchObject({ ok: true, po: { code: 'PO-20931', status: 'delayed' } });
    expect(result.rendering).toMatch(/^Purchase order P O dash two zero nine three one /);
  });

  it('answers a failure payload when the model sends malformed JSON', async () => {
    const result = JSON.parse(await toolUseToResult('not json'));
    expect(result).toMatchObject({ ok: false, reason: 'invalid_code' });
  });

  it('passes the delay hook through', async () => {
    const waits: number[] = [];
    await toolUseToResult('{"po_code":"PO-10482"}', {
      delayMs: 5,
      sleep: async (ms) => void waits.push(ms),
    });
    expect(waits).toEqual([5]);
  });
});
