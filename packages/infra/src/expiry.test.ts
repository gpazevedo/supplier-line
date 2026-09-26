import { describe, expect, it } from 'vitest';
import { requireExpiresAt } from './expiry';

describe('requireExpiresAt', () => {
  it('accepts an ISO 8601 UTC timestamp', () => {
    expect(requireExpiresAt('2026-09-26T18:30:00Z')).toBe('2026-09-26T18:30:00Z');
  });

  it.each([undefined, '', 'tomorrow', '2026-09-26', '2026-09-26T18:30:00', '2026-13-40T99:00:00Z'])(
    'throws for %j',
    (value) => {
      expect(() => requireExpiresAt(value)).toThrow(/ExpiresAt/);
    }
  );
});
