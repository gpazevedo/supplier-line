export interface FillerTimerHooks {
  /** The stall has lasted `stallMs` with no agent audio yet for `turn`. */
  onFire(turn: number): void;
}

/**
 * Tracks the FH-03 stall per turn: `caller` (re)starts the clock whenever the caller finishes
 * speaking with no answer yet; `audio` cancels it once the agent's first audio for the turn
 * arrives. Fires at most once per turn.
 */
export class FillerTimer {
  private timer?: NodeJS.Timeout;
  private firedFor = new Set<number>();
  private stopped = false;

  constructor(
    private readonly stallMs: number,
    private readonly hooks: FillerTimerHooks
  ) {}

  /** The caller finished speaking (or spoke again) in `turn`, with no answer yet. */
  caller(turn: number): void {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.firedFor.has(turn)) return;
    this.timer = setTimeout(() => this.fire(turn), this.stallMs);
  }

  /** The agent's first audio for the turn in progress arrived. */
  audio(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /**
   * Stops the timer for good, so no later `caller` call (from an event still draining out of the
   * closing connection) can schedule a filler that would fire after the session has ended.
   */
  stop(): void {
    this.stopped = true;
    this.audio();
  }

  private fire(turn: number): void {
    this.firedFor.add(turn);
    this.hooks.onFire(turn);
  }
}
