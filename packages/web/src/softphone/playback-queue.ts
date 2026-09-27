interface Chunk {
  turn: number;
  samples: Float32Array;
}

/**
 * Agent audio waiting to play, tagged by turn. `pull` hands out samples in order and counts
 * what actually played per turn; `flush` drops everything still queued.
 */
export class PlaybackQueue {
  private chunks: Chunk[] = [];
  private played = new Map<number, number>();
  private reported = new Map<number, number>();

  constructor(private readonly sampleRate: number) {}

  push(turn: number, samples: Float32Array): void {
    this.chunks.push({ turn, samples });
  }

  /** Fills `out` with the next samples, padding with silence once the queue runs dry. */
  pull(out: Float32Array): void {
    let filled = 0;
    while (filled < out.length && this.chunks.length) {
      const chunk = this.chunks[0];
      const take = Math.min(out.length - filled, chunk.samples.length);
      out.set(chunk.samples.subarray(0, take), filled);
      this.played.set(chunk.turn, (this.played.get(chunk.turn) ?? 0) + take);
      chunk.samples = chunk.samples.subarray(take);
      if (!chunk.samples.length) this.chunks.shift();
      filled += take;
    }
    out.fill(0, filled);
  }

  flush(): void {
    this.chunks = [];
  }

  playedMs(turn: number): number {
    return this.toMs(this.played.get(turn) ?? 0);
  }

  /** Turns whose played milliseconds changed since the last call, for reporting to the host. */
  changedTurns(): { turn: number; ms: number }[] {
    const changed = [...this.played.keys()]
      .map((turn) => ({ turn, ms: this.playedMs(turn) }))
      .filter(({ turn, ms }) => this.reported.get(turn) !== ms);
    changed.forEach(({ turn, ms }) => this.reported.set(turn, ms));
    return changed;
  }

  queuedMs(): number {
    return this.toMs(this.chunks.reduce((sum, chunk) => sum + chunk.samples.length, 0));
  }

  private toMs(samples: number): number {
    return Math.round((samples / this.sampleRate) * 1000);
  }
}
