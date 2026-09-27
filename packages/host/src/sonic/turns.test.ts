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
      audio: { planned_ms: 0, delivered_ms: 0, played_ms: 0 },
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

it('fills the playback ledger: speculative text, agent audio, interruption and client reports', () => {
  const r = new TurnRecorder();
  const oneSecond = Buffer.alloc(48_000).toString('base64');
  textBlock(r, 'u1', 'USER', FINAL, 0)('Status of PO-10482?');
  textBlock(r, 'a1', 'ASSISTANT', SPECULATIVE, 900)('Purchase order.');
  r.onEvent('contentStart', { contentId: 'x1', type: 'AUDIO', role: 'ASSISTANT' }, 1000);
  r.onEvent('audioOutput', { contentId: 'x1', content: oneSecond }, 1000);
  r.onEvent('audioOutput', { contentId: 'x1', content: oneSecond }, 1100);
  expect(r.currentTurn).toBe(0);
  r.ledger.played(0, 600);
  r.onEvent('contentEnd', { contentId: 'm1', type: 'TEXT', stopReason: 'INTERRUPTED' }, 1700);
  r.ledger.flushed(0, 650, 1760);

  expect(r.turns()[0]).toMatchObject({
    audio: { planned_ms: 2000, delivered_ms: 2000, played_ms: 650, flush_latency_ms: 60 },
    bargein: { at_ms: 600 },
  });
});

it('builds history from caller text and heard agent text, cutting barged-in turns', () => {
  const r = new TurnRecorder();
  const oneSecond = Buffer.alloc(48_000).toString('base64');
  textBlock(r, 'u1', 'USER', FINAL, 0)('Status of');
  textBlock(r, 'u2', 'USER', FINAL, 10)('PO-10482?');
  r.onEvent('audioOutput', { contentId: 'x1', content: oneSecond }, 20);
  textBlock(r, 'a1', 'ASSISTANT', FINAL, 30)('Purchase order P O dash one zero.');
  r.ledger.played(0, 1100);
  r.onEvent('contentEnd', { contentId: 'm1', type: 'TEXT', stopReason: 'INTERRUPTED' }, 40);
  textBlock(r, 'a2', 'ASSISTANT', FINAL, 50)('{ "interrupted" : true }');
  textBlock(r, 'u3', 'USER', FINAL, 60)('And the delivery date?');
  textBlock(r, 'a3', 'ASSISTANT', FINAL, 70)('October twenty-fourth.');

  expect(r.history()).toEqual([
    { role: 'USER', text: 'Status of PO-10482?' },
    { role: 'ASSISTANT', text: 'Purchase order P O' },
    { role: 'USER', text: 'And the delivery date?' },
    { role: 'ASSISTANT', text: 'October twenty-fourth.' },
  ]);
});

it('times latency from the last caller segment before the agent answers', () => {
  const r = new TurnRecorder();
  textBlock(r, 'u1', 'USER', FINAL, 5000)('What is the status of');
  textBlock(r, 'u2', 'USER', FINAL, 9300)('PO-10482?');
  r.onEvent('audioOutput', { contentId: 'x1', content: 'AAAA' }, 9800);
  expect(r.turns()).toHaveLength(1);
  expect(r.turns()[0].latency.voice_to_voice_ms).toBe(500);
});

it('replays a turn answered from a tool result without the agent reply', () => {
  const r = new TurnRecorder();
  const rendering =
    'Purchase order P O dash one zero four eight two from Summit Fasteners has shipped.';
  textBlock(r, 'u1', 'USER', FINAL, 0)('Status of PO-10482?');
  r.onToolResult('get_po_status', rendering);
  textBlock(r, 'a1', 'ASSISTANT', FINAL, 30)(`Let me check that. ${rendering}`);
  textBlock(r, 'u2', 'USER', FINAL, 60)('Thanks.');
  textBlock(r, 'a2', 'ASSISTANT', FINAL, 70)('You are welcome.');

  expect(r.history()).toEqual([
    { role: 'USER', text: 'Status of PO-10482?' },
    { role: 'USER', text: 'Thanks.' },
    { role: 'ASSISTANT', text: 'You are welcome.' },
  ]);
});
