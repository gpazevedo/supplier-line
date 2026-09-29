const PREFIX_CHARS = 30;
const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

interface Pending {
  turn: number;
  prefix: string;
  spoken: string;
  nudged: boolean;
}

/**
 * Prompt-to-speak: Sonic sometimes ends its response ("Let me check that.") and never speaks a
 * tool result it was given. Once a result is owed, has not started being spoken, and Sonic has
 * been quiet for `delayMs` since its response ended (or since the result arrived), `nudge` asks
 * for it, at most once per result. The caller speaking again drops the result owed.
 */
export class SpeakNudge {
  private pending?: Pending;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly delayMs: number,
    private readonly hooks: { nudge(turn: number): void }
  ) {}

  toolResult(turn: number, rendering: string): void {
    const prefix = normalise(rendering.slice(0, PREFIX_CHARS));
    this.pending = { turn, prefix, spoken: '', nudged: false };
    this.arm();
  }

  /** Agent text (speculative or final): Sonic is speaking, maybe the result. */
  assistantText(text: string): void {
    this.cancel();
    const pending = this.pending;
    if (!pending) return;
    pending.spoken = normalise(`${pending.spoken} ${text}`);
    if (pending.spoken.includes(pending.prefix)) this.pending = undefined;
  }

  /** Sonic ended a response. */
  responseEnded(): void {
    this.arm();
  }

  callerSpoke(): void {
    this.cancel();
    this.pending = undefined;
  }

  stop(): void {
    this.callerSpoke();
  }

  private arm(): void {
    this.cancel();
    if (this.pending && !this.pending.nudged) {
      this.timer = setTimeout(() => this.fire(), this.delayMs);
    }
  }

  private cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private fire(): void {
    if (!this.pending) return;
    this.pending.nudged = true;
    this.hooks.nudge(this.pending.turn);
  }
}
