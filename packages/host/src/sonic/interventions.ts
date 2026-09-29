import { AnswerGuard } from './answer-guard.js';
import { SpeakNudge } from './speak-nudge.js';
import type { TurnRecorder } from './turns.js';

/** How long Sonic may stay quiet with a lookup result unspoken before it is asked to speak it. */
export const NUDGE_AFTER_MS = 3000;

export const SPEAK_NOW =
  'Speak the get_po_status result you just received now, word for word as its rendering.';
export const LOOK_UP_FIRST =
  'Do not answer purchase-order questions from memory. Call get_po_status for that purchase order now and speak its new rendering exactly.';

export interface InterventionDeps {
  recorder: TurnRecorder;
  /** Sends Sonic a cross-modal text message on the current connection. */
  sendText(text: string): void;
  /** Drops the agent audio the caller has queued for `turn`. */
  flush(turn: number): void;
  log(line: string): void;
}

/**
 * The host's two nudges to Sonic, both traced on the turn: prompt-to-speak (A) when a lookup
 * result is left unspoken, and blocked-answer (B) when a turn with no lookup starts speaking PO
 * data, whose audio is then muted until a lookup result arrives.
 */
export class Interventions {
  private readonly guard = new AnswerGuard();
  private readonly nudge: SpeakNudge;

  constructor(
    nudgeAfterMs: number,
    private readonly deps: InterventionDeps
  ) {
    this.nudge = new SpeakNudge(nudgeAfterMs, { nudge: (turn) => this.promptToSpeak(turn) });
  }

  toolResult(turn: number, rendering: string): void {
    this.guard.toolResult(turn);
    this.deps.recorder.unmute();
    this.nudge.toolResult(turn, rendering);
  }

  /**
   * Agent text. Only SPECULATIVE text can block: it is new generation, while a FINAL follows
   * playback and can land after the caller has already started the next turn.
   */
  assistantText(turn: number, text: string, final: boolean): void {
    this.nudge.assistantText(text);
    if (!final && this.guard.assistantText(turn, text)) this.block(turn);
  }

  responseEnded(): void {
    this.nudge.responseEnded();
  }

  callerSpoke(): void {
    this.nudge.callerSpoke();
  }

  /** True while `turn`'s agent audio must not reach the caller. */
  mutes(turn: number | undefined): boolean {
    return this.guard.muted(turn);
  }

  stop(): void {
    this.nudge.stop();
  }

  private promptToSpeak(turn: number): void {
    this.send(turn, 'prompt-to-speak', SPEAK_NOW);
  }

  private block(turn: number): void {
    this.deps.recorder.mute(turn);
    this.deps.flush(turn);
    this.send(turn, 'blocked-answer', LOOK_UP_FIRST);
  }

  private send(turn: number, kind: 'prompt-to-speak' | 'blocked-answer', text: string): void {
    const { recorder } = this.deps;
    recorder.onIntervention(turn, kind);
    recorder.expectHostInterruption();
    this.deps.sendText(text);
    this.deps.log(`${kind} on turn ${turn}`);
  }
}
