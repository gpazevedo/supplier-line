import { describe, expect, it } from 'vitest';
import { callerStillReading, spokenDigits } from './reading.js';

describe('spokenDigits', () => {
  it('reads digit words, "oh" and numerals in order', () => {
    expect(spokenDigits("what's the status of purchase order p o ? dash one zero four")).toBe(
      '104'
    );
    expect(spokenDigits('eight two.')).toBe('82');
    expect(spokenDigits('PO 10482')).toBe('10482');
    expect(spokenDigits('one oh four')).toBe('104');
  });

  it('finds none in a follow-up', () => {
    expect(spokenDigits('and the delivery date?')).toBe('');
  });
});

describe('callerStillReading', () => {
  const noSleep = async () => undefined;

  it('holds a call made mid-code until the caller has said all five digits', async () => {
    const texts = ['dash one zero four', 'dash one zero four', 'dash one zero four eight two'];
    const text = () => (texts.length > 1 ? (texts.shift() ?? '') : texts[0]);
    expect(await callerStillReading(text, 4000, noSleep)).toBe(true);
    expect(texts).toEqual(['dash one zero four eight two']);
  });

  it('gives up waiting after the timeout, still holding the call', async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    expect(await callerStillReading(() => 'dash one zero four', 400, sleep)).toBe(true);
    expect(waits.reduce((a, b) => a + b, 0)).toBe(400);
  });

  it('lets the call run with five or more digits, or none (a follow-up reusing the last order)', async () => {
    expect(await callerStillReading(() => 'p o one zero four eight two', 4000, noSleep)).toBe(
      false
    );
    expect(await callerStillReading(() => 'and the delivery date?', 4000, noSleep)).toBe(false);
  });
});
