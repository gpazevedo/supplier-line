/** Unbounded single-consumer queue that an SDK can iterate as a request stream. */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private ended = false;
  private wake?: () => void;

  /** Queues `item`; false once the queue has ended. */
  push(item: T): boolean {
    if (this.ended) return false;
    this.items.push(item);
    this.wake?.();
    return true;
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
