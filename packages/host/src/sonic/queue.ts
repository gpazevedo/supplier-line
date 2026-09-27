/** Unbounded single-consumer queue that an SDK can iterate as a request stream. */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private ended = false;
  private wake?: () => void;

  push(item: T): void {
    if (this.ended) return;
    this.items.push(item);
    this.wake?.();
  }

  end(): void {
    this.ended = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      const item = this.items.shift();
      if (item !== undefined) yield item;
      else if (this.ended) return;
      else await new Promise<void>((resolve) => (this.wake = resolve));
    }
  }
}
