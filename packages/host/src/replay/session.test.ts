import { setTimeout as wait } from 'node:timers/promises';
import { afterEach, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { runClip } from './session.js';

let wss: WebSocketServer | undefined;

afterEach(() => {
  wss?.close();
  wss = undefined;
});

function fakeHost(onConnection: (socket: WebSocket) => void): Promise<string> {
  wss = new WebSocketServer({ port: 0 });
  wss.on('connection', onConnection);
  return new Promise((resolve) => {
    wss?.once('listening', () => {
      const port = (wss?.address() as { port: number }).port;
      resolve(`ws://127.0.0.1:${port}/ws`);
    });
  });
}

/** Real time elapsed; a prompt rejection should be far below the player's 90 s no-answer timeout. */
async function elapsed<T>(work: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const started = Date.now();
  const result = await work();
  return { result, ms: Date.now() - started };
}

it('rejects promptly when the host sends `rejected` and closes with 4401', async () => {
  const url = await fakeHost((socket) => {
    socket.send(JSON.stringify({ type: 'rejected', reason: 'wrong access code' }));
    socket.close(4401, 'wrong access code');
  });

  const failure = elapsed(() =>
    runClip({ url, sequence: [Buffer.alloc(0)] }).then(
      () => {
        throw new Error('expected runClip to reject');
      },
      (error: unknown) => error
    )
  );
  const { result: error, ms } = await failure;
  expect(String((error as Error).message)).toContain('call rejected: wrong access code');
  expect(ms).toBeLessThan(2000);
});

it('rejects promptly when the host closes with 4429, even without a `rejected` message', async () => {
  const url = await fakeHost((socket) => {
    socket.close(4429, 'too many concurrent sessions');
  });

  const { result: error, ms } = await elapsed(() =>
    runClip({ url, sequence: [Buffer.alloc(0)] }).then(
      () => {
        throw new Error('expected runClip to reject');
      },
      (error: unknown) => error
    )
  );
  expect(String((error as Error).message)).toContain('4429');
  expect(String((error as Error).message)).toContain('too many concurrent sessions');
  expect(ms).toBeLessThan(2000);
});

it('does not hang once rejected: the socket is already closed by the time runClip settles', async () => {
  const url = await fakeHost((socket) => {
    socket.send(JSON.stringify({ type: 'rejected', reason: 'missing access code' }));
    socket.close(4401, 'missing access code');
  });

  await runClip({ url, sequence: [Buffer.alloc(0)] }).catch(() => undefined);
  await wait(10);
  expect(wss?.clients.size).toBe(0);
});
