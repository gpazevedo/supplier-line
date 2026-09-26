import type { Trace } from 'traces/src/schema.js';
import { el } from './dom.js';

type Turn = Trace['turns'][number];

const percent = (value: number, max: number) => `${Math.min(100, (value / max) * 100)}%`;

function bar(
  kind: string,
  label: string,
  value: number,
  max: number,
  bargeinAt?: number
): HTMLElement {
  const fill = el('span', `bar-fill ${kind}`);
  fill.style.width = percent(value, max);
  const track = el('span', 'bar-track', fill);
  if (bargeinAt !== undefined) {
    const line = el('span', 'bargein-line');
    line.style.left = percent(bargeinAt, max);
    track.append(line);
  }
  return el(
    'div',
    'bar-row',
    el('span', 'bar-label', label),
    track,
    el('span', 'bar-value', `${value} ms`)
  );
}

function bargeinCaption(at_ms: number, flush_latency_ms?: number): HTMLElement {
  const flush =
    flush_latency_ms === undefined ? '' : `, playback flushed in ${flush_latency_ms} ms`;
  const caption = el('p', 'marker bargein', `Barge-in at ${at_ms} ms${flush}`);
  caption.dataset.marker = 'bargein';
  return caption;
}

/** Planned, generated and heard bars on one scale, with a line and caption where the caller cut in. */
export function renderAudio(turn: Turn, max: number): HTMLElement {
  const { audio, bargein } = turn;
  if (!audio) return el('p', 'muted', 'Audio ledger not exposed by this front door.');
  const at = bargein?.at_ms;
  const bars = el(
    'div',
    'bars',
    bar('planned', 'Planned', audio.planned_ms, max, at),
    bar('generated', 'Generated', audio.delivered_ms, max, at),
    bar('heard', 'Heard', audio.played_ms, max, at)
  );
  if (bargein) bars.append(bargeinCaption(bargein.at_ms, audio.flush_latency_ms));
  return bars;
}
