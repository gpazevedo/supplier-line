import { expect, it } from 'vitest';
import { AsyncQueue } from './queue.js';

async function drain<T>(queue: AsyncQueue<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of queue) out.push(item);
  return out;
}

it('yields items pushed before and after iteration starts, then stops on end', async () => {
  const queue = new AsyncQueue<number>();
  queue.push(1);
  const drained = drain(queue);
  queue.push(2);
  queue.end();
  expect(await drained).toEqual([1, 2]);
});

it('ignores pushes after end', async () => {
  const queue = new AsyncQueue<number>();
  queue.end();
  queue.push(1);
  expect(await drain(queue)).toEqual([]);
});

it('push reports whether the queue accepted the item', () => {
  const queue = new AsyncQueue<number>();
  expect(queue.push(1)).toBe(true);
  queue.end();
  expect(queue.push(2)).toBe(false);
});
