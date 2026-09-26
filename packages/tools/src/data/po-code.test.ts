import { describe, expect, it } from 'vitest';
import { checkDigit, isValidPoCode } from './po-code';

describe('checkDigit', () => {
  it.each([
    ['1048', 2],
    ['2093', 1],
    ['0000', 3],
    ['1234', 9],
  ])('body %s has check digit %i', (body, digit) => {
    expect(checkDigit(body)).toBe(digit);
  });
});

describe('isValidPoCode', () => {
  it('accepts the two recorded codes', () => {
    expect(isValidPoCode('PO-10482')).toBe(true);
    expect(isValidPoCode('PO-20931')).toBe(true);
  });

  it('rejects malformed codes', () => {
    for (const code of ['PO-1048', 'PO-104822', 'XX-10482', 'PO-1048a', '10482']) {
      expect(isValidPoCode(code)).toBe(false);
    }
  });

  it('rejects every single wrong digit of every possible code', () => {
    const accepted: string[] = [];
    for (let n = 0; n < 10_000; n++) {
      const body = String(n).padStart(4, '0');
      const code = `PO-${body}${checkDigit(body)}`;
      if (!isValidPoCode(code)) accepted.push(`valid code rejected: ${code}`);
      for (let i = 3; i < code.length; i++) {
        for (const d of '0123456789'.replace(code[i], '')) {
          const wrong = code.slice(0, i) + d + code.slice(i + 1);
          if (isValidPoCode(wrong)) accepted.push(`${wrong} (from ${code})`);
        }
      }
    }
    expect(accepted).toEqual([]);
  });
});
