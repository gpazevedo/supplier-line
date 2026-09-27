import { expect, it } from 'vitest';
import { ResponseTracker } from './response.js';

const FINAL = '{"generationStage":"FINAL"}';
const SPECULATIVE = '{"generationStage":"SPECULATIVE"}';

function text(t: ResponseTracker, id: string, role: string, stage: string, content: string) {
  const start = t.onEvent('contentStart', {
    contentId: id,
    type: 'TEXT',
    role,
    additionalModelFields: stage,
  });
  return [start, t.onEvent('textOutput', { contentId: id, content })];
}

it('signals speaking on assistant audio, complete once every speculative text has its final', () => {
  const t = new ResponseTracker();
  expect(text(t, 'u1', 'USER', FINAL, 'Status?')).toEqual([undefined, undefined]);
  expect(text(t, 's1', 'ASSISTANT', SPECULATIVE, 'Purchase order.')).toEqual([
    undefined,
    undefined,
  ]);
  expect(t.onEvent('contentStart', { contentId: 'x1', type: 'AUDIO', role: 'ASSISTANT' })).toBe(
    'speaking'
  );
  expect(text(t, 's2', 'ASSISTANT', SPECULATIVE, 'It shipped.')[1]).toBeUndefined();
  expect(text(t, 'f1', 'ASSISTANT', FINAL, 'Purchase order.')[1]).toBeUndefined();
  expect(text(t, 'f2', 'ASSISTANT', FINAL, 'It shipped.')[1]).toBe('complete');
});

it('signals complete on an interrupted text block and ignores the marker text', () => {
  const t = new ResponseTracker();
  text(t, 's1', 'ASSISTANT', SPECULATIVE, 'Purchase order.');
  expect(text(t, 'f1', 'ASSISTANT', FINAL, '{ "interrupted" : true }')[1]).toBeUndefined();
  expect(t.onEvent('contentEnd', { type: 'TEXT', stopReason: 'INTERRUPTED' })).toBe('complete');
});

it('is idle until the agent starts a response and again once it completes', () => {
  const t = new ResponseTracker();
  expect(t.idle).toBe(true);
  text(t, 's1', 'ASSISTANT', SPECULATIVE, 'Go on.');
  expect(t.idle).toBe(false);
  text(t, 'f1', 'ASSISTANT', FINAL, 'Go on.');
  expect(t.idle).toBe(true);
});

const RENDERING = 'Purchase order P O dash one zero four eight two has shipped.';

it('holds completion while a tool call waits for its rendering to be spoken', () => {
  const t = new ResponseTracker();
  t.onEvent('toolUse', { toolName: 'get_po_status' });
  t.toolResult(RENDERING);
  text(t, 's1', 'ASSISTANT', SPECULATIVE, 'Go on');
  expect(text(t, 'f1', 'ASSISTANT', FINAL, 'Go on')[1]).toBeUndefined();
  expect(t.idle).toBe(false);
  text(t, 's2', 'ASSISTANT', SPECULATIVE, 'Purchase order P O dash one zero four eight two');
  const reply = 'Sure. Purchase order P O dash one zero four eight two has shipped.';
  expect(text(t, 'f2', 'ASSISTANT', FINAL, reply)[1]).toBe('complete');
});

it('releases a pending tool call when the caller speaks again after the agent replied', () => {
  const t = new ResponseTracker();
  t.onEvent('toolUse', { toolName: 'get_po_status' });
  t.toolResult(RENDERING);
  text(t, 'u1', 'USER', FINAL, 'two');
  expect(t.idle).toBe(false);
  text(t, 's1', 'ASSISTANT', SPECULATIVE, 'Go on');
  text(t, 'f1', 'ASSISTANT', FINAL, 'Go on');
  text(t, 'u2', 'USER', FINAL, 'Never mind.');
  expect(t.idle).toBe(true);
});

it('releases a pending tool call on an interruption', () => {
  const t = new ResponseTracker();
  t.onEvent('toolUse', { toolName: 'get_po_status' });
  expect(t.onEvent('contentEnd', { type: 'TEXT', stopReason: 'INTERRUPTED' })).toBe('complete');
  expect(t.idle).toBe(true);
});

it('completes the next response after an interruption left a speculative text without its final', () => {
  const t = new ResponseTracker();
  text(t, 's1', 'ASSISTANT', SPECULATIVE, 'I need all five digits.');
  text(t, 'f1', 'ASSISTANT', FINAL, '{ "interrupted" : true }');
  t.onEvent('contentEnd', { type: 'TEXT', stopReason: 'INTERRUPTED' });
  text(t, 's2', 'ASSISTANT', SPECULATIVE, 'Let me check that.');
  expect(text(t, 'f2', 'ASSISTANT', FINAL, 'Let me check that.')[1]).toBe('complete');
  expect(t.idle).toBe(true);
});
