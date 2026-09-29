import { expect, it } from 'vitest';
import { AnswerGuard } from './answer-guard.js';

const PO_ANSWER = 'Purchase order one zero four eight two from Summit Fasteners has shipped.';

it('blocks a turn that starts speaking PO data with no lookup, once', () => {
  // Live long-repeat turn 14: after a rotation, Sonic repeated an earlier result from memory.
  const guard = new AnswerGuard();
  expect(guard.assistantText(3, 'Let me check that.')).toBe(false);
  expect(guard.muted(3)).toBe(false);
  expect(guard.assistantText(3, PO_ANSWER)).toBe(true);
  expect(guard.muted(3)).toBe(true);
  expect(guard.assistantText(3, 'The amount is forty-five thousand euros.')).toBe(false);
  expect(guard.muted(3)).toBe(true);
});

it('never blocks a turn with a lookup result, and a result unmutes a blocked turn', () => {
  const guard = new AnswerGuard();
  guard.toolResult(1);
  expect(guard.assistantText(1, PO_ANSWER)).toBe(false);

  guard.assistantText(2, PO_ANSWER);
  guard.toolResult(2);
  expect(guard.muted(2)).toBe(false);
});

it('mutes only the blocked turn', () => {
  const guard = new AnswerGuard();
  guard.assistantText(2, PO_ANSWER);
  expect(guard.muted(3)).toBe(false);
});
