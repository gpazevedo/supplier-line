import { describe, expect, it } from 'vitest';
import { parseTraceText } from './load.js';

describe('parseTraceText', () => {
  it('rejects JSON that is not a trace, naming the field', () => {
    expect(() => parseTraceText('{"session_id": "x"}')).toThrow(/front_door/);
  });
});
