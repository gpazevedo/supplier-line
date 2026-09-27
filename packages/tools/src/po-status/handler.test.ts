import { describe, expect, it, vi } from 'vitest';
import { getPoStatus } from './handler';

describe('getPoStatus, recorded POs', () => {
  it('returns the shipped PO and its spoken rendering', async () => {
    expect(await getPoStatus({ po_code: 'PO-10482' })).toEqual({
      ok: true,
      po: {
        code: 'PO-10482',
        supplier: 'Summit Fasteners',
        status: 'shipped',
        amountCents: 4521618,
        currency: 'EUR',
        orderDate: '2026-10-04',
        dueDate: '2026-10-24',
      },
      rendering:
        'Purchase order P O dash one zero four eight two from Summit Fasteners has shipped. ' +
        'The amount is forty-five thousand two hundred sixteen euros and eighteen cents. ' +
        'It was ordered on October fourth, twenty twenty-six, ' +
        'and delivery is due on October twenty-fourth, twenty twenty-six.',
    });
  });

  it('says when a delivered PO arrived and omits delivery for a cancelled one', async () => {
    const delivered = await getPoStatus({ po_code: 'PO-89422' });
    expect(delivered.rendering).toBe(
      'Purchase order P O dash eight nine four two two from Summit Fasteners was delivered. ' +
        'The amount is thirty-six thousand one hundred twelve dollars and six cents. ' +
        'It was ordered on October twenty-fifth, twenty twenty-six, ' +
        'and delivered on November sixteenth, twenty twenty-six.'
    );
    const cancelled = await getPoStatus({ po_code: 'PO-77946' });
    expect(cancelled.rendering).toBe(
      'Purchase order P O dash seven seven nine four six from Summit Fasteners was cancelled. ' +
        'The amount is five thousand six hundred forty-three euros and sixty-three cents. ' +
        'It was ordered on October thirteenth, twenty twenty-six.'
    );
  });

  it('returns the delayed PO and its spoken rendering', async () => {
    const result = await getPoStatus({ po_code: 'PO-20931' });
    expect(result).toMatchObject({
      ok: true,
      po: {
        code: 'PO-20931',
        status: 'delayed',
        dueDate: '2026-09-30',
        expectedDate: '2026-10-04',
      },
    });
    expect(result.rendering).toBe(
      'Purchase order P O dash two zero nine three one from Summit Fasteners is delayed. ' +
        'The amount is twenty-six thousand three hundred fifty-three dollars and seventy-eight cents. ' +
        'It was ordered on September fifteenth, twenty twenty-six. ' +
        'Delivery was due on September thirtieth, twenty twenty-six ' +
        'and is now expected on October fourth, twenty twenty-six.'
    );
  });
});

describe('getPoStatus, spoken-style input', () => {
  it.each([
    'po-10482',
    'PO 10482',
    'P O 1 0 4 8 2',
    'P O dash one zero four eight two',
    'po one oh four eight two',
    ' Po-1048-2 ',
  ])('normalises %j to PO-10482', async (spoken) => {
    const result = await getPoStatus({ po_code: spoken });
    expect(result).toMatchObject({ ok: true, po: { code: 'PO-10482' } });
  });
});

describe('getPoStatus, reason codes', () => {
  it.each(['banana', '', 'PO-123', 'PO-104822', { po_code: 42 }, undefined])(
    'invalid_code for %j',
    async (bad) => {
      const input = typeof bad === 'string' ? { po_code: bad } : bad;
      expect(await getPoStatus(input)).toEqual({
        ok: false,
        reason: 'invalid_code',
        rendering:
          "Sorry, I didn't catch a purchase order code. " +
          'Could you say it again, one digit at a time?',
      });
    }
  );

  it('check_digit_failed when the last digit does not match', async () => {
    expect(await getPoStatus({ po_code: 'PO-10483' })).toEqual({
      ok: false,
      reason: 'check_digit_failed',
      rendering:
        "Sorry, P O dash one zero four eight three doesn't look like a valid purchase order code. " +
        'Could you say it again, one digit at a time?',
    });
  });

  it('not_found for a well-formed code that is not on file', async () => {
    expect(await getPoStatus({ po_code: 'PO-00003' })).toEqual({
      ok: false,
      reason: 'not_found',
      rendering:
        "Sorry, I couldn't find purchase order P O dash zero zero zero zero three. " +
        'Could you check the number and say it again?',
    });
  });
});

describe('getPoStatus, delay-injection hook', () => {
  it('waits delayMs through the injected sleep before answering', async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    const result = await getPoStatus({ po_code: 'PO-10482' }, { delayMs: 25_000, sleep });
    expect(waits).toEqual([25_000]);
    expect(result.ok).toBe(true);
  });

  it('is off by default', async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    await getPoStatus({ po_code: 'PO-10482' }, { sleep });
    expect(waits).toEqual([]);
  });

  it('really waits with the default sleep', async () => {
    vi.useFakeTimers();
    let done = false;
    const pending = getPoStatus({ po_code: 'PO-10482' }, { delayMs: 1000 }).then(
      () => (done = true)
    );
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(done).toBe(true);
    vi.useRealTimers();
  });
});
