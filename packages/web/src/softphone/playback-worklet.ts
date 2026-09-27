import { PlaybackQueue } from './playback-queue.js';

/** What the page tells the player: a turn marker, agent audio, or a flush after a barge-in. */
export type PlaybackCommand =
  | { type: 'turn'; index: number }
  | { type: 'audio'; samples: Float32Array }
  | { type: 'flush'; turn?: number };

/** What the player reports back, forwarded as-is to the host. */
export interface PlaybackReport {
  type: 'played' | 'flushed';
  turn: number;
  ms: number;
}

/** Ten 128-sample render blocks: about 53 ms at 24 kHz. */
const REPORT_EVERY_BLOCKS = 10;

/** Plays agent audio from a queue, reports milliseconds played per turn and flushes on request. */
class Playback extends AudioWorkletProcessor {
  private readonly queue = new PlaybackQueue(sampleRate);
  private turn = -1;
  private blocks = 0;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<PlaybackCommand>) => this.onCommand(event.data);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    this.queue.pull(outputs[0][0]);
    if (++this.blocks % REPORT_EVERY_BLOCKS === 0) this.report();
    return true;
  }

  private onCommand(command: PlaybackCommand): void {
    if (command.type === 'turn') this.turn = command.index;
    if (command.type === 'audio') this.queue.push(this.turn, command.samples);
    if (command.type === 'flush') this.flush(command.turn ?? this.turn);
  }

  /** Drops queued audio and reports how much of the interrupted turn played. */
  private flush(turn: number): void {
    this.queue.flush();
    this.report();
    this.post({ type: 'flushed', turn, ms: this.queue.playedMs(turn) });
  }

  private report(): void {
    this.queue.changedTurns().forEach(({ turn, ms }) => this.post({ type: 'played', turn, ms }));
  }

  private post(report: PlaybackReport): void {
    this.port.postMessage(report);
  }
}

registerProcessor('playback', Playback);
