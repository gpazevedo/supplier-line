import { expect, it } from 'vitest';
import { loadFixedPhrases } from './fixed.js';

it('loads the captured FH-01/03/10 phrases, matching FIXED_PHRASES text', () => {
  const phrases = loadFixedPhrases();
  expect(Object.keys(phrases).sort()).toEqual(['FH-01', 'FH-03', 'FH-10']);
  expect(phrases['FH-01'].text).toBe(
    "Sorry, this line can't take your call right now. Please try again shortly."
  );
  expect(phrases['FH-03'].text).toBe('One moment.');
  expect(phrases['FH-10'].text).toBe('Still checking, one moment.');
  for (const id of ['FH-01', 'FH-03', 'FH-10'] as const) {
    expect(phrases[id].pcm.length).toBeGreaterThan(0);
    expect(phrases[id].pcm.length % 2).toBe(0); // whole 16-bit samples
  }
});
