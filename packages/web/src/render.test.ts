// @vitest-environment happy-dom
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Trace } from 'traces/src/schema.js';
import { describe, expect, it } from 'vitest';
import { parseTraceText } from './load.js';
import { renderTrace } from './render.js';

const dir = join(fileURLToPath(import.meta.url), '../../../traces/samples');
const samples = readdirSync(dir)
  .filter((name) => name.endsWith('.json'))
  .map((name) => ({ name, trace: parseTraceText(readFileSync(join(dir, name), 'utf8')) }));

describe.each(samples)('renders $name', ({ trace }) => {
  const page = renderTrace(trace);

  it('shows the session and one block per turn', () => {
    expect(page.querySelector('h2')?.textContent).toBe(trace.session_id);
    expect(page.querySelectorAll('.turn')).toHaveLength(trace.turns.length);
  });

  it('shows assistant text, latency and tool rendering for every turn', () => {
    const turns = [...page.querySelectorAll('.turn')];
    trace.turns.forEach((turn, i) => {
      const text = turns[i].textContent;
      expect(text).toContain(turn.assistant.final_text);
      expect(text).toContain(`${turn.latency.voice_to_voice_ms} ms`);
      if (turn.tool) expect(text).toContain(turn.tool.rendering);
      if (turn.filler?.played) expect(text).toContain('Filler played');
    });
  });

  it('shows planned, generated and heard bars only where the ledger exists', () => {
    const withAudio = trace.turns.filter((turn) => turn.audio).length;
    expect(page.querySelectorAll('.bars')).toHaveLength(withAudio);
    expect(page.querySelectorAll('.bar-fill.heard')).toHaveLength(withAudio);
    expect(page.querySelectorAll('.muted').length).toBeGreaterThan(trace.turns.length - withAudio);
  });

  it('marks every barge-in with its time and flush latency', () => {
    const cuts = trace.turns.filter((turn) => turn.bargein);
    const markers = page.querySelectorAll('[data-marker="bargein"]');
    expect(markers).toHaveLength(cuts.length);
    cuts.forEach((turn, i) => {
      expect(markers[i].textContent).toContain(`${turn.bargein?.at_ms} ms`);
      expect(markers[i].textContent).toContain(`${turn.audio?.flush_latency_ms} ms`);
    });
  });

  it('marks every failure behaviour by fh.id', () => {
    const ids = [...page.querySelectorAll('[data-fh]')].map((node) => node.getAttribute('data-fh'));
    expect(ids).toEqual(trace.events.map((event) => event.fh.id));
  });
});

describe('rotation marker', () => {
  it('shows the handoff gap and audio counts', () => {
    const rotation = samples.find((s) => s.name === 'softphone-rotation.json');
    const text = renderTrace(rotation?.trace as Trace).querySelector(
      '[data-fh="FH-05"]'
    )?.textContent;
    expect(text).toContain('gap 180 ms');
    expect(text).toContain('forwarded 8200 ms');
  });
});
