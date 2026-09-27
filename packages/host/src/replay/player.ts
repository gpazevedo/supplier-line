import { floatFromPcm16 } from 'web/src/softphone/pcm.js';
import { PlaybackQueue } from 'web/src/softphone/playback-queue.js';
import type { ClientMessage } from '../sessions.js';
import { OUTPUT_RATE } from '../sonic/events.js';

/**
 * Plays agent audio against the wall clock, as the browser worklet does, reports milliseconds
 * played per turn to the host, and honours `flush`.
 */
export class ReplayPlayer {
  private readonly queue = new PlaybackQueue(OUTPUT_RATE);
  private readonly startedAt = Date.now();
  private pulled = 0;
  private turn = -1;

  constructor(private readonly send: (message: ClientMessage) => void) {}

  startTurn(index: number): void {
    this.turn = index;
  }

  add(pcm: Buffer): void {
    this.queue.push(this.turn, floatFromPcm16(pcm));
  }

  /** Drops queued audio and tells the host how much of the turn played. */
  flush(): number {
    this.tick();
    this.queue.flush();
    const ms = this.queue.playedMs(this.turn);
    this.send({ type: 'flushed', turn: this.turn, ms });
    return ms;
  }

  /** Plays the samples due since the last tick and reports turns whose played total changed. */
  tick(): void {
    const due = Math.floor(((Date.now() - this.startedAt) * OUTPUT_RATE) / 1000) - this.pulled;
    this.queue.pull(new Float32Array(due));
    this.pulled += due;
    this.queue.changedTurns().forEach(({ turn, ms }) => this.send({ type: 'played', turn, ms }));
  }

  get idle(): boolean {
    return this.queue.queuedMs() === 0;
  }
}
