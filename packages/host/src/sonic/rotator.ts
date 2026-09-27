import type { HistoryMessage } from './history.js';
import { ResponseTracker } from './response.js';

/** What the rotator needs from one Sonic connection. */
export interface RotatingConnection {
  /** Resolves once the stream is open (setup events sent, no caller audio yet). */
  readonly opened: Promise<void>;
  /** Replays `history`, then opens the caller-audio container. */
  resume(history: HistoryMessage[]): void;
  /** Forwards caller audio; false if the connection no longer accepts it. */
  sendAudio(pcm: Buffer): boolean;
  close(): void;
}

export interface RotatorHooks<C> {
  open(): C;
  history(): HistoryMessage[];
  rotated(stats: RotationStats): void;
}

export interface RotatorOptions {
  /** Connection age after which the next response triggers a rotation. */
  thresholdMs: number;
  /** Caller audio replayed into the next connection. */
  bufferMs: number;
  /** How long to wait for the agent to speak before rotating anyway. */
  audioStartTimeoutMs: number;
}

/**
 * One handoff: `gapMs` from the response completing to the next connection going live, and the
 * caller audio received during the transition versus what reached the old or the next connection.
 */
export interface RotationStats {
  gapMs: number;
  audioInMs: number;
  audioForwardedMs: number;
}

interface Chunk {
  pcm: Buffer;
  forwarded: boolean;
}

type State = 'live' | 'armed' | 'transitioning' | 'handing-over';

const BYTES_PER_MS = 32;
const msOf = (chunks: Chunk[]) =>
  Math.round(chunks.reduce((sum, c) => sum + c.pcm.length, 0) / BYTES_PER_MS);

/**
 * Rotates Sonic connections before their 8-minute limit, porting AWS's Python session-continuation
 * pattern: past the threshold, once the agent starts speaking (or after a timeout), open the next
 * connection and record caller audio; when the response completes, replay the history and the
 * last `bufferMs` of caller audio into it, make it current and close the old one.
 */
export class Rotator<C extends RotatingConnection> {
  private state: State = 'live';
  private timer?: NodeJS.Timeout;
  private tracker = new ResponseTracker();
  private next?: C;
  private window: Chunk[] = [];
  private closed = false;

  constructor(
    public current: C,
    private readonly hooks: RotatorHooks<C>,
    private readonly options: RotatorOptions
  ) {
    this.schedule();
  }

  audio(pcm: Buffer): void {
    const forwarded = this.current.sendAudio(pcm);
    if (this.state === 'transitioning' || this.state === 'handing-over') {
      this.window.push({ pcm, forwarded });
    }
  }

  /** Feeds one output event; events from any connection but the current one are ignored. */
  onOutput(from: C, name: string, body: Record<string, unknown>): void {
    if (from !== this.current) return;
    const signal = this.tracker.onEvent(name, body);
    if (signal === 'speaking' && this.state === 'armed') this.begin();
    else if (signal === 'complete' && this.state === 'transitioning') void this.handOver();
  }

  /** The rendering a tool call on `from` returned; the response stays open until it is spoken. */
  onToolResult(from: C, rendering: string): void {
    if (from === this.current) this.tracker.toolResult(rendering);
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.next?.close();
    this.current.close();
  }

  private schedule(): void {
    this.state = 'live';
    this.timer = setTimeout(() => this.arm(), this.options.thresholdMs);
  }

  private arm(): void {
    this.state = 'armed';
    this.timer = setTimeout(() => this.begin(), this.options.audioStartTimeoutMs);
  }

  private begin(): void {
    clearTimeout(this.timer);
    this.state = 'transitioning';
    this.window = [];
    this.next = this.hooks.open();
    if (this.tracker.idle) void this.handOver();
  }

  private async handOver(): Promise<void> {
    const next = this.next as C;
    this.state = 'handing-over';
    const completedAt = Date.now();
    try {
      await next.opened;
    } catch (error) {
      console.error('next Sonic connection failed to open', error);
      this.next = undefined;
      if (!this.closed) this.arm();
      return;
    }
    if (this.closed) return;
    next.resume(this.hooks.history());
    this.replayBuffer(next);
    const old = this.current;
    [this.current, this.next, this.tracker] = [next, undefined, new ResponseTracker()];
    old.close();
    const stats = {
      gapMs: Date.now() - completedAt,
      audioInMs: msOf(this.window),
      audioForwardedMs: msOf(this.window.filter((c) => c.forwarded)),
    };
    this.window = [];
    this.schedule();
    this.hooks.rotated(stats);
  }

  private replayBuffer(next: C): void {
    let ms = 0;
    const buffered = this.window.toReversed().filter((chunk) => {
      ms += chunk.pcm.length / BYTES_PER_MS;
      return ms <= this.options.bufferMs;
    });
    for (const chunk of buffered.toReversed()) {
      if (next.sendAudio(chunk.pcm)) chunk.forwarded = true;
    }
  }
}
