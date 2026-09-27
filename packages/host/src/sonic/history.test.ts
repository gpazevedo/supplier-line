import { expect, it } from 'vitest';
import { heardText } from './history.js';

it('keeps the whole text when the caller heard at least its spoken length', () => {
  expect(heardText('Purchase order shipped.', 5000)).toBe('Purchase order shipped.');
});

it('cuts at the last whole word heard, at 55 ms per character', () => {
  // 20 characters heard: "Purchase order P O d" → last whole word ends at "O".
  expect(heardText('Purchase order P O dash one zero', 1100)).toBe('Purchase order P O');
});

it('returns nothing when no whole word was heard', () => {
  expect(heardText('Purchase order', 200)).toBe('');
});
