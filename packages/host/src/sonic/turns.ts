import type { Trace } from 'traces/src/index.js';
import { heardText, type HistoryMessage } from './history.js';
import { PlaybackLedger } from './ledger.js';

type TraceTurn = Trace['turns'][number];
type Intervention = NonNullable<TraceTurn['interventions']>[number];

interface Block {
  role: string;
  final: boolean;
}

interface OpenTurn {
  index: number;
  callerAt: number;
  firstAudioAt?: number;
  tool?: { name: string; rendering: string };
  earlyToolCalls: number;
  caller: string[];
  spoken: string[];
  fillerPlayed?: boolean;
  /** ASSISTANT segments spoken as SPECULATIVE text with no FINAL confirmation yet, in order. */
  pendingSpeculative: Segment[];
  interventions: Intervention[];
}

/** A speculative segment; a muted one was never played, so its FINAL is not what was spoken. */
interface Segment {
  text: string;
  muted: boolean;
}

type Body = Record<string, unknown>;

export const isInterruption = (text: string) => /"interrupted"\s*:\s*true/.test(text);

/** Caller speech counts as a barge-in only while more than this much agent audio is unheard. */
const STILL_PLAYING_MS = 250;

/**
 * Folds Sonic output events into trace turns. A turn starts with the caller's transcript;
 * its latency runs from the caller's last transcript segment to the first agent audio chunk. The playback ledger
 * records planned, generated and heard audio per turn.
 */
export class TurnRecorder {
  readonly ledger = new PlaybackLedger();
  private blocks = new Map<string, Block>();
  private open: OpenTurn[] = [];
  /** Turn whose agent text and audio the host is withholding from the caller. */
  private mutedTurn?: number;
  /** Agent text confirmed as heard (FINAL, or a spoken segment whose FINAL never came), unread. */
  private confirmed: string[] = [];
  /** The host sent Sonic text, which interrupts Sonic's response without the caller speaking. */
  private hostInterruptionExpected = false;

  /** Index of the turn now in progress; undefined before the caller first speaks. */
  get currentTurn(): number | undefined {
    return this.current?.index;
  }

  /**
   * Feeds one output event, stamped with milliseconds since the session started. Returns true
   * when it cuts the current turn off: Sonic's INTERRUPTED, or Sonic detecting caller speech
   * while the caller is still hearing its answer (its own clock may already count the answer as
   * played, and then it sends no INTERRUPTED). Each turn is cut off at most once.
   */
  onEvent(name: string, body: Body, atMs: number): boolean {
    const id = String(body.contentId);
    if (name === 'contentStart') this.blocks.set(id, blockOf(body));
    if (name === 'audioOutput') this.onAudio(String(body.content), atMs);
    if (name === 'textOutput') this.onText(this.blocks.get(id), String(body.content), atMs);
    if (name === 'contentEnd' && body.stopReason === 'INTERRUPTED') return this.onInterrupted(atMs);
    if (name === 'userSpeechStart') this.hostInterruptionExpected = false;
    if (name === 'userSpeechStart' && this.stillPlaying()) return this.interrupt(atMs);
    return false;
  }

  /** The caller's transcript so far in the current turn. */
  callerText(): string {
    return this.current?.caller.join(' ') ?? '';
  }

  /** Counts a lookup refused because the caller was still reading the code. */
  onEarlyToolCall(): void {
    if (this.current) this.current.earlyToolCalls += 1;
  }

  /** Records the rendering a tool returned during the current turn. */
  onToolResult(name: string, rendering: string): void {
    if (this.current) this.current.tool = { name, rendering };
  }

  /**
   * Records a fixed phrase (FH-01) played directly on the socket as a whole turn: `text` is its
   * only spoken content, `bytes` its audio, played the instant it is detected. Returns the new
   * turn's index.
   */
  onFallback(text: string, bytes: number, atMs: number): number {
    const index = this.open.length;
    this.open.push({
      index,
      callerAt: atMs,
      firstAudioAt: atMs,
      caller: [],
      spoken: [text],
      earlyToolCalls: 0,
      pendingSpeculative: [],
      interventions: [],
    });
    this.ledger.generated(index, bytes);
    return index;
  }

  /**
   * Records a filler phrase (FH-03/FH-10) played directly during `turnIndex`: its audio counts
   * toward that turn's generated/delivered total, and `filler.played` is set in its trace entry.
   */
  onFiller(turnIndex: number, bytes: number): void {
    const turn = this.open[turnIndex];
    if (!turn) return;
    turn.fillerPlayed = true;
    this.ledger.generated(turnIndex, bytes);
  }

  /** Agent text confirmed as heard since the last call, in order. */
  takeConfirmed(): string[] {
    return this.confirmed.splice(0);
  }

  /** Withholds `turn`'s agent text from now on, including the segment just received. */
  mute(turn: number): void {
    this.mutedTurn = turn;
    const last = this.open[turn]?.pendingSpeculative.at(-1);
    if (last) last.muted = true;
  }

  unmute(): void {
    this.mutedTurn = undefined;
  }

  onIntervention(turn: number, kind: Intervention): void {
    this.open[turn]?.interventions.push(kind);
  }

  /** The next INTERRUPTED comes from text the host sent, unless the caller speaks first. */
  expectHostInterruption(): void {
    this.hostInterruptionExpected = true;
  }

  turns(): TraceTurn[] {
    return this.open.map((turn, index) => ({
      index,
      latency: {
        voice_to_voice_ms: Math.max(0, (turn.firstAudioAt ?? turn.callerAt) - turn.callerAt),
      },
      ...this.ledger.entry(index),
      ...(turn.tool && { tool: turn.tool }),
      ...(turn.earlyToolCalls > 0 && { early_tool_calls: turn.earlyToolCalls }),
      ...(turn.fillerPlayed && { filler: { played: true } }),
      ...(turn.interventions.length > 0 && { interventions: turn.interventions }),
      assistant: { final_text: turn.spoken.join(' ') },
    }));
  }

  /**
   * Caller and agent text per turn; a barged-in answer keeps only what the caller heard. An answer
   * built from a tool result is left out: a new connection copies earlier replies, so it would
   * speak that PO data again without calling the tool.
   */
  history(): HistoryMessage[] {
    return this.open.flatMap((turn) => {
      const messages: HistoryMessage[] = [
        { role: 'USER', text: turn.caller.join(' ') },
        { role: 'ASSISTANT', text: turn.tool ? '' : this.heard(turn) },
      ];
      return messages.filter((message) => message.text);
    });
  }

  private heard(turn: OpenTurn): string {
    const spoken = turn.spoken.join(' ');
    const heardMs = this.ledger.heardMs(turn.index);
    return heardMs === undefined ? spoken : heardText(spoken, heardMs);
  }

  private get current(): OpenTurn | undefined {
    return this.open.at(-1);
  }

  private onAudio(base64: string, atMs: number): void {
    const turn = this.current;
    if (!turn) return;
    turn.firstAudioAt ??= atMs;
    this.ledger.generated(turn.index, Buffer.byteLength(base64, 'base64'));
  }

  private onInterrupted(atMs: number): boolean {
    if (!this.hostInterruptionExpected) return this.interrupt(atMs);
    this.hostInterruptionExpected = false;
    return false;
  }

  private interrupt(atMs: number): boolean {
    const turn = this.currentTurn;
    if (turn === undefined || this.ledger.isInterrupted(turn)) return false;
    this.ledger.interrupted(turn, atMs);
    return true;
  }

  /** Sonic has spoken in the current turn and the caller has not heard all of it yet. */
  private stillPlaying(): boolean {
    const turn = this.current;
    if (turn?.firstAudioAt === undefined) return false;
    return this.ledger.unplayedMs(turn.index) > STILL_PLAYING_MS;
  }

  private onText(block: Block | undefined, text: string, atMs: number): void {
    const muted = this.mutedTurn !== undefined && this.mutedTurn === this.current?.index;
    if (block?.role === 'ASSISTANT' && !block.final && this.current) {
      if (!muted) this.ledger.planned(this.current.index, text);
      this.current.pendingSpeculative.push({ text: text.trim(), muted });
    }
    if (!block?.final || isInterruption(text)) return;
    if (block.role === 'USER' && this.answered())
      this.open.push({
        index: this.open.length,
        callerAt: atMs,
        caller: [],
        spoken: [],
        earlyToolCalls: 0,
        pendingSpeculative: [],
        interventions: [],
      });
    else if (block.role === 'USER' && this.current) this.current.callerAt = atMs;
    if (block.role === 'USER') this.current?.caller.push(text.trim());
    if (block.role === 'ASSISTANT' && this.current) {
      const heard = settle(this.current.pendingSpeculative, text.trim(), muted);
      this.current.spoken.push(...heard);
      this.confirmed.push(...heard);
    }
  }

  /**
   * Sonic has finished this response for good (no more FINAL text is coming): call on a
   * `completionEnd` event. Any ASSISTANT segment still stuck at SPECULATIVE — a real Sonic gap,
   * seen for a long multi-sentence rendering whose trailing FINAL never arrives even though its
   * audio was fully spoken — falls back to its speculative text, so the trace and history aren't
   * missing what the caller heard. Returns the segments recovered this way, in order, so the
   * caller can also report them as live transcript lines.
   */
  onCompletionEnd(): string[] {
    const recovered: string[] = [];
    for (const turn of this.open) {
      const unheard = turn.pendingSpeculative.filter((segment) => !segment.muted);
      recovered.push(...unheard.map((segment) => segment.text));
      turn.spoken.push(...unheard.map((segment) => segment.text));
      turn.pendingSpeculative = [];
    }
    return recovered;
  }

  /** True when there is no turn yet, or the current one already has agent output. */
  private answered(): boolean {
    const turn = this.current;
    return !turn || turn.spoken.length > 0 || turn.firstAudioAt !== undefined;
  }
}

/**
 * Settles the pending segment a FINAL confirms: the one with the same text, else the oldest.
 * Segments before it never got their FINAL (a blocked answer Sonic was interrupted in, or a Sonic
 * gap): muted ones are dropped, the rest were spoken. Returns the heard text, in order.
 */
function settle(pending: Segment[], final: string, muted: boolean): string[] {
  const match = pending.findIndex((segment) => segment.text === final);
  const skipped = match > 0 ? pending.splice(0, match) : [];
  const settled = pending.shift();
  const heard = skipped.filter((segment) => !segment.muted).map((segment) => segment.text);
  return (settled?.muted ?? muted) ? heard : [...heard, final];
}

function blockOf(body: Body): Block {
  const fields = typeof body.additionalModelFields === 'string' ? body.additionalModelFields : '';
  return { role: String(body.role), final: fields.includes('"FINAL"') };
}
