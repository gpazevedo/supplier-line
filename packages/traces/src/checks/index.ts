import type { Trace } from '../schema.js';

type Turn = Trace['turns'][number];

/** One violated rule: which check, where (turn index or event), and why. */
export interface Failure {
  check: string;
  where: string;
  message: string;
}

const failure = (check: string, where: string, message: string): Failure => ({
  check,
  where,
  message,
});

/** Audio played is at most audio delivered. Skipped when the turn has no audio ledger. */
function heardLeGenerated(turn: Turn): Failure[] {
  const { audio } = turn;
  if (!audio || audio.played_ms <= audio.delivered_ms) return [];
  return [
    failure(
      'heard-le-generated',
      `turn ${turn.index}`,
      `played ${audio.played_ms} ms exceeds delivered ${audio.delivered_ms} ms`
    ),
  ];
}

const MAX_FLUSH_MS = 300;

/** After a barge-in, playback stops within 300 ms. Skipped without an audio ledger. */
function fastFlush(turn: Turn): Failure[] {
  const flush = turn.audio?.flush_latency_ms;
  if (!turn.audio || !turn.bargein || (flush !== undefined && flush <= MAX_FLUSH_MS)) return [];
  const found = flush === undefined ? 'no flush_latency_ms recorded' : `flush took ${flush} ms`;
  return [failure('fast-flush', `turn ${turn.index}`, `${found}; limit is ${MAX_FLUSH_MS} ms`)];
}

/** Where a tool returned a value and no barge-in cut the answer, the spoken text contains it. */
function exactRendering(turn: Turn): Failure[] {
  const { tool, bargein, assistant } = turn;
  if (!tool || bargein || assistant.final_text.includes(tool.rendering)) return [];
  return [failure('exact-rendering', `turn ${turn.index}`, `final_text lacks "${tool.rendering}"`)];
}

const MAX_SILENCE_MS = 2500;

/** Agent audio or a filler starts within 2.5 s of the caller stopping. Skipped without an audio ledger. */
function noDeadAir(turn: Turn): Failure[] {
  const ms = turn.latency.voice_to_voice_ms;
  if (!turn.audio || ms <= MAX_SILENCE_MS || turn.filler?.played) return [];
  return [
    failure(
      'no-dead-air',
      `turn ${turn.index}`,
      `${ms} ms to first audio with no filler; limit is ${MAX_SILENCE_MS} ms`
    ),
  ];
}

/** Across every FH-05 handoff, caller audio received equals caller audio forwarded to Sonic. */
function rotationLosesNothing(event: Trace['events'][number]): Failure[] {
  const { rotation } = event;
  if (
    event.fh.id !== 'FH-05' ||
    !rotation ||
    rotation.audio_in_ms === rotation.audio_forwarded_ms
  ) {
    return [];
  }
  return [
    failure(
      'rotation-loses-nothing',
      `FH-05 at ${event.at_ms} ms`,
      `audio_in ${rotation.audio_in_ms} ms but audio_forwarded ${rotation.audio_forwarded_ms} ms`
    ),
  ];
}

const turnChecks = [heardLeGenerated, fastFlush, exactRendering, noDeadAir];

/** Runs the five acceptance checks over one trace and returns every violation. */
export function runChecks(trace: Trace): Failure[] {
  return [
    ...trace.turns.flatMap((turn) => turnChecks.flatMap((check) => check(turn))),
    ...trace.events.flatMap(rotationLosesNothing),
  ];
}
