import type { Trace } from 'traces/src/schema.js';
import { renderAudio } from './audio-bars.js';
import { el } from './dom.js';

type Turn = Trace['turns'][number];
type Event = Trace['events'][number];

const FH_LABELS = {
  'FH-01': 'Stream would not open: fallback prompt',
  'FH-03': 'Stall: filler played',
  'FH-05': 'Session rotation',
  'FH-10': 'Tool timeout: filler and retry',
} as const;

/** One failure-behaviour marker, labelled by its fh.id; rotation events also show the handoff numbers. */
export function renderEvent(event: Event): HTMLElement {
  const { id } = event.fh;
  const { rotation } = event;
  const detail = rotation
    ? `, gap ${rotation.gap_ms} ms, caller audio in ${rotation.audio_in_ms} ms, forwarded ${rotation.audio_forwarded_ms} ms`
    : '';
  const marker = el(
    'li',
    'marker fh',
    el('strong', '', id),
    ` ${FH_LABELS[id]} at ${event.at_ms} ms${detail}`
  );
  marker.dataset.fh = id;
  return marker;
}

function renderTurn(turn: Turn, events: Event[], max: number): HTMLElement {
  const details = el('div', 'details');
  if (turn.tool)
    details.append(el('p', '', el('strong', '', `Tool ${turn.tool.name}: `), turn.tool.rendering));
  if (turn.filler?.played) details.append(el('p', 'marker filler', 'Filler played while waiting'));
  const article = el(
    'article',
    'turn',
    el(
      'h3',
      '',
      `Turn ${turn.index}`,
      el('span', 'latency', ` ${turn.latency.voice_to_voice_ms} ms voice to voice`)
    ),
    renderAudio(turn, max),
    details,
    el('p', 'said', `“${turn.assistant.final_text}”`)
  );
  if (events.length) article.append(el('ul', 'events', ...events.map(renderEvent)));
  return article;
}

/** The longest planned or delivered audio in the trace, so every turn's bars share one scale. */
function audioScale(turns: Turn[]): number {
  return Math.max(
    1,
    ...turns.map((turn) => Math.max(turn.audio?.planned_ms ?? 0, turn.audio?.delivered_ms ?? 0))
  );
}

/** A full session: header, per-turn timeline, and the events not tied to a turn. */
export function renderTrace(trace: Trace): HTMLElement {
  const max = audioScale(trace.turns);
  const turns = trace.turns.map((turn) =>
    renderTurn(
      turn,
      trace.events.filter((event) => event.turn === turn.index),
      max
    )
  );
  const sessionEvents = trace.events.filter((event) => event.turn === undefined);
  const section = el(
    'section',
    'trace',
    el('h2', '', trace.session_id),
    el('p', 'muted', `${trace.front_door} front door, started ${trace.started_at}`),
    ...turns
  );
  if (sessionEvents.length) {
    section.append(
      el('h3', '', 'Session events'),
      el('ul', 'events', ...sessionEvents.map(renderEvent))
    );
  }
  return section;
}
