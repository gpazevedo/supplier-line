import { expect, it } from 'vitest';
import type { ClientMessage } from '../sessions.js';
import { ReplayPlayer } from './player.js';

it('reports a flush against the interrupted turn, even before that turn sent any audio', () => {
  const sent: ClientMessage[] = [];
  const player = new ReplayPlayer((message) => sent.push(message));
  player.startTurn(0);
  player.add(Buffer.alloc(480));
  player.flush(1);
  expect(sent.at(-1)).toEqual({ type: 'flushed', turn: 1, ms: 0 });
});
