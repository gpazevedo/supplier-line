export interface FillerTimerHooks {
  /** The stall has lasted `stallMs` with no agent audio for `turn`. */
  onFire(turn: number): void;
  /** The turn in progress, read when the timer fires. */
  currentTurn(): number | undefined;
}

/**
 * Tracks the FH-03 stall: the clock starts when Sonic detects the end of the caller's speech and
 * stops when the caller speaks again or the agent's audio arrives, so a pause mid-code (inside one
 * stretch of speech) never counts. Fires at most once per turn.
 */
export class FillerTimer {
  private timer?: NodeJS.Timeout;
  private firedFor = new Set<number>();
  private stopped = false;

  constructor(
    private readonly stallMs: number,
    private readonly hooks: FillerTimerHooks
  ) {}

  /** Sonic detected the caller stopped speaking (`userSpeechEnd`). */
  speechEnded(): void {
    this.cancel();
    if (!this.stopped) this.timer = setTimeout(() => this.fire(), this.stallMs);
  }

  /** Sonic detected the caller speaking (`userSpeechStart`). */
  speechStarted(): void {
    this.cancel();
  }

  /** Agent audio arrived. */
  audio(): void {
    this.cancel();
  }

  /**
   * Stops the timer for good, so no later call (from an event still draining out of the closing
   * connection) can schedule a filler that would fire after the session has ended.
   */
  stop(): void {
    this.stopped = true;
    this.cancel();
  }

  private cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private fire(): void {
    const turn = this.hooks.currentTurn();
    if (turn === undefined || this.firedFor.has(turn)) return;
    this.firedFor.add(turn);
    this.hooks.onFire(turn);
  }
}
