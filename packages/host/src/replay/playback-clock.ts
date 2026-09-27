/** Emulates a real-time player: tracks when the agent audio received so far would finish playing. */
export class PlaybackClock {
  /** Epoch ms when queued audio finishes; 0 before any audio. */
  endsAt = 0;

  constructor(private readonly sampleRate: number) {}

  /** Queues `bytes` of 16-bit mono PCM that arrived at `nowMs`. */
  add(bytes: number, nowMs: number): void {
    this.endsAt = Math.max(this.endsAt, nowMs) + (bytes / 2 / this.sampleRate) * 1000;
  }
}
