import type { Trace } from 'traces/src/index.js';

type TraceTurn = Trace['turns'][number];

/** Matthew's speaking rate, measured on S13 replays (about 53–60 ms per character). */
export const SPOKEN_MS_PER_CHAR = 55;
const BYTES_PER_MS = 48;

interface TurnLedger {
  plannedChars: number;
  generatedBytes: number;
  playedMs: number;
  interruptedAt?: number;
  heardAtInterruption?: number;
  flushedAt?: number;
}

/**
 * Per-turn playback ledger. Planned comes from the model's speculative text, generated from the
 * agent audio Sonic sent, heard from what the client reports it played. Times are session ms.
 */
export class PlaybackLedger {
  private turns = new Map<number, TurnLedger>();

  planned(turn: number, text: string): void {
    this.at(turn).plannedChars += text.trim().length;
  }

  /** Agent audio received from Sonic: 24 kHz 16-bit mono PCM bytes. */
  generated(turn: number, bytes: number): void {
    this.at(turn).generatedBytes += bytes;
  }

  /** The client's running total of milliseconds played for the turn. */
  played(turn: number, ms: number): void {
    const ledger = this.at(turn);
    ledger.playedMs = Math.max(ledger.playedMs, ms);
  }

  /** Sonic signalled a barge-in; the heard cut-off is what the client had reported so far. */
  interrupted(turn: number, atMs: number): void {
    const ledger = this.at(turn);
    ledger.interruptedAt = atMs;
    ledger.heardAtInterruption = ledger.playedMs;
  }

  /** The client flushed its queue after a barge-in, having played `ms` of the turn. */
  flushed(turn: number, ms: number, atMs: number): void {
    this.played(turn, ms);
    this.at(turn).flushedAt = atMs;
  }

  /** Milliseconds of the turn's audio delivered but not yet reported played. */
  unplayedMs(turn: number): number {
    const ledger = this.turns.get(turn);
    return ledger ? Math.round(ledger.generatedBytes / BYTES_PER_MS) - ledger.playedMs : 0;
  }

  isInterrupted(turn: number): boolean {
    return this.turns.get(turn)?.interruptedAt !== undefined;
  }

  /** Milliseconds of the turn the caller heard, if a barge-in cut it; undefined otherwise. */
  heardMs(turn: number): number | undefined {
    const ledger = this.turns.get(turn);
    return ledger?.interruptedAt === undefined ? undefined : ledger.playedMs;
  }

  /** The trace fields for one turn: `audio`, plus `bargein` when the caller cut in. */
  entry(turn: number): Pick<TraceTurn, 'audio' | 'bargein'> {
    const ledger = this.turns.get(turn);
    if (!ledger?.generatedBytes) return {};
    const delivered = Math.round(ledger.generatedBytes / BYTES_PER_MS);
    if (ledger.interruptedAt === undefined) {
      return {
        audio: { planned_ms: delivered, delivered_ms: delivered, played_ms: ledger.playedMs },
      };
    }
    const flush =
      ledger.flushedAt === undefined
        ? {}
        : { flush_latency_ms: ledger.flushedAt - ledger.interruptedAt };
    return {
      audio: {
        planned_ms: Math.max(delivered, ledger.plannedChars * SPOKEN_MS_PER_CHAR),
        delivered_ms: delivered,
        played_ms: ledger.playedMs,
        ...flush,
      },
      bargein: { at_ms: ledger.heardAtInterruption ?? 0 },
    };
  }

  private at(turn: number): TurnLedger {
    const ledger = this.turns.get(turn) ?? { plannedChars: 0, generatedBytes: 0, playedMs: 0 };
    this.turns.set(turn, ledger);
    return ledger;
  }
}
