import { expect, it } from 'vitest';
import { TurnRecorder } from './turns.js';

const FINAL = '{"generationStage":"FINAL"}';
const SPECULATIVE = '{"generationStage":"SPECULATIVE"}';

function textBlock(r: TurnRecorder, id: string, role: string, stage: string, at: number) {
  r.onEvent(
    'contentStart',
    { contentId: id, type: 'TEXT', role, additionalModelFields: stage },
    at
  );
  return (content: string, t = at) => r.onEvent('textOutput', { contentId: id, content }, t);
}

it('builds one turn from caller transcript, tool result, audio and final text', () => {
  const r = new TurnRecorder();
  textBlock(r, 'u1', 'USER', FINAL, 1000)('What is the status of PO-10482?', 1000);
  r.onToolResult('get_po_status', 'Purchase order P O dash one.');
  textBlock(r, 'a1', 'ASSISTANT', SPECULATIVE, 1500)('Purchase order P O dash one.');
  r.onEvent('contentStart', { contentId: 'x1', type: 'AUDIO', role: 'ASSISTANT' }, 1700);
  r.onEvent('audioOutput', { contentId: 'x1', content: 'AAAA' }, 1800);
  r.onEvent('audioOutput', { contentId: 'x1', content: 'AAAA' }, 1900);
  textBlock(r, 'a2', 'ASSISTANT', FINAL, 3000)('Purchase order P O dash one.');

  expect(r.turns()).toEqual([
    {
      index: 0,
      latency: { voice_to_voice_ms: 800 },
      tool: { name: 'get_po_status', rendering: 'Purchase order P O dash one.' },
      assistant: { final_text: 'Purchase order P O dash one.' },
    },
  ]);
});

it('joins several FINAL assistant segments with spaces and ignores speculative text', () => {
  const r = new TurnRecorder();
  textBlock(r, 'u1', 'USER', FINAL, 0)('Hi');
  textBlock(r, 'a1', 'ASSISTANT', SPECULATIVE, 10)('draft');
  textBlock(r, 'a2', 'ASSISTANT', FINAL, 20)('Hello.');
  textBlock(r, 'a3', 'ASSISTANT', FINAL, 30)(' How can I help?');
  expect(r.turns()[0].assistant.final_text).toBe('Hello. How can I help?');
});

it('starts a new turn when the caller speaks after the agent answered', () => {
  const r = new TurnRecorder();
  textBlock(r, 'u1', 'USER', FINAL, 0)('One');
  textBlock(r, 'a1', 'ASSISTANT', FINAL, 10)('Reply one.');
  textBlock(r, 'u2', 'USER', FINAL, 20)('Two');
  textBlock(r, 'a2', 'ASSISTANT', FINAL, 30)('Reply two.');
  expect(r.turns().map((t) => [t.index, t.assistant.final_text])).toEqual([
    [0, 'Reply one.'],
    [1, 'Reply two.'],
  ]);
});

it('ignores the interruption marker text', () => {
  const r = new TurnRecorder();
  textBlock(r, 'u1', 'USER', FINAL, 0)('Hi');
  textBlock(r, 'a1', 'ASSISTANT', FINAL, 10)('{ "interrupted" : true }');
  expect(r.turns()[0].assistant.final_text).toBe('');
});

it('records no turns before the caller speaks', () => {
  const r = new TurnRecorder();
  textBlock(r, 'a1', 'ASSISTANT', FINAL, 10)('Welcome.');
  expect(r.turns()).toEqual([]);
});
