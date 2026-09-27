import { describe, expect, it } from 'vitest';
import { FIXED_PHRASES } from './index';

describe('fixed phrases', () => {
  it('has one entry per failure behaviour, each with non-empty text', () => {
    expect(FIXED_PHRASES.map((p) => p.id).sort()).toEqual(['FH-01', 'FH-03', 'FH-10']);
    for (const phrase of FIXED_PHRASES) expect(phrase.text.trim().length).toBeGreaterThan(0);
  });

  it('never duplicates the system prompt\'s own "Let me check that." filler', () => {
    for (const phrase of FIXED_PHRASES) {
      expect(phrase.text.toLowerCase()).not.toContain('let me check that');
    }
  });
});
