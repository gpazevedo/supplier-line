import { describe, expect, it } from 'vitest';
import dates from './golden/dates.json';
import invalid from './golden/invalid.json';
import money from './golden/money.json';
import poCodes from './golden/po-codes.json';
import { renderDate, renderMoney, renderPoCode } from './index';

describe('renderMoney', () => {
  it.each(money)('$cents $currency', ({ cents, currency, spoken }) => {
    expect(renderMoney(cents, currency)).toBe(spoken);
  });

  it.each(invalid.money)('rejects $cents $currency', ({ cents, currency }) => {
    expect(() => renderMoney(cents, currency)).toThrow();
  });
});

describe('renderDate', () => {
  it.each(dates)('$iso', ({ iso, spoken }) => {
    expect(renderDate(iso)).toBe(spoken);
  });

  it.each(invalid.dates)('rejects "%s"', (iso) => {
    expect(() => renderDate(iso)).toThrow();
  });
});

describe('renderPoCode', () => {
  it.each(poCodes)('$code', ({ code, spoken }) => {
    expect(renderPoCode(code)).toBe(spoken);
  });

  it.each(invalid.poCodes)('rejects "%s"', (code) => {
    expect(() => renderPoCode(code)).toThrow();
  });
});
