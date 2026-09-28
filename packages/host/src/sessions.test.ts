import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as wait } from 'node:timers/promises';
import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import type { TraceWriter } from 'traces/src/index.js';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { AsyncQueue } from './sonic/queue.js';
import { attachSessions, type SessionDeps, type SessionLimits } from './sessions.js';

const ACCESS_CODE = 'let-me-in';
const ROTATION = {
  thresholdMs: 10_000_000,
  bufferMs: 3000,
  audioStartTimeoutMs: 20_000,
  handoverTimeoutMs: 30_000,
};

interface Chunk {
  chunk: { bytes: Uint8Array };
}

/**
 * A Bedrock client that never sends any event and never ends the response stream on its own: a
 * Sonic connection built on it stays open until `SonicConnection.close()` ends its outbound queue,
 * at which point this fake ends the matching response stream too, so `SonicSession.run()` settles
 * the same way it would against the real service.
 */
function fakeClient(): { client: BedrockRuntimeClient; calls: () => number } {
  let calls = 0;
  const send = async (command: { input: { body: AsyncIterable<Chunk> } }) => {
    calls++;
    const response = new AsyncQueue<Chunk>();
    void (async () => {
      for await (const _chunk of command.input.body) {
        // draining the outbound queue; the fake never echoes it back
      }
      response.end();
    })();
    return { body: response };
  };
  return { client: { send } as unknown as BedrockRuntimeClient, calls: () => calls };
}

function fakeWriter(): TraceWriter {
  return { write: async () => 'traces/fake.json' };
}

/** Wraps a client socket, recording every frame from the moment it's created so none are missed. */
class Recorder {
  readonly socket: WebSocket;
  readonly messages: unknown[] = [];
  readonly frames: Buffer[] = [];
  readonly opened: Promise<void>;
  readonly closed: Promise<{ code: number; reason: string }>;

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.opened = new Promise((resolve) => this.socket.once('open', () => resolve()));
    this.closed = new Promise((resolve) => {
      this.socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });
    this.socket.on('message', (data, isBinary) => {
      if (isBinary) this.frames.push(data as Buffer);
      else this.messages.push(JSON.parse(data.toString()));
    });
  }

  async end(): Promise<void> {
    await this.opened;
    this.socket.send(JSON.stringify({ type: 'end' }));
    await this.closed;
  }
}

/** Polls until `predicate` is true, rather than racing a single event against a listener. */
async function until(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await wait(5);
  }
}

let server: Server;
let base: string;
let deps: Omit<SessionDeps, 'client'>;

beforeEach(async () => {
  server = createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
  deps = {
    writer: fakeWriter(),
    rotation: ROTATION,
    accessCode: ACCESS_CODE,
    notices: { warning: Buffer.alloc(200), expired: Buffer.alloc(200) },
    phrases: {
      'FH-01': { text: 'fallback', pcm: Buffer.alloc(200) },
      'FH-03': { text: 'filler one', pcm: Buffer.alloc(50) },
      'FH-10': { text: 'filler two', pcm: Buffer.alloc(50) },
    },
  };
});

afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

it('rejects a connection with no access code, before any Bedrock call', async () => {
  const { client, calls } = fakeClient();
  attachSessions(server, { ...deps, client });
  const rec = new Recorder(base);
  const close = await rec.closed;
  expect(rec.messages).toEqual([{ type: 'rejected', reason: 'missing access code' }]);
  expect(close.code).toBe(4401);
  expect(calls()).toBe(0);
});

it('rejects a connection with the wrong access code, before any Bedrock call', async () => {
  const { client, calls } = fakeClient();
  attachSessions(server, { ...deps, client });
  const rec = new Recorder(`${base}?code=wrong`);
  const close = await rec.closed;
  expect(rec.messages).toEqual([{ type: 'rejected', reason: 'wrong access code' }]);
  expect(close.code).toBe(4401);
  expect(calls()).toBe(0);
});

it('accepts the right access code and opens a Sonic connection', async () => {
  const { client, calls } = fakeClient();
  attachSessions(server, { ...deps, client });
  const rec = new Recorder(`${base}?code=${ACCESS_CODE}`);
  await until(() => calls() > 0);
  await rec.end();
});

it('refuses a third concurrent session with a clear reason', async () => {
  const { client } = fakeClient();
  attachSessions(server, { ...deps, client, limits: { maxConcurrent: 2 } });
  const first = new Recorder(`${base}?code=${ACCESS_CODE}`);
  const second = new Recorder(`${base}?code=${ACCESS_CODE}`);
  await Promise.all([first.opened, second.opened]);

  const third = new Recorder(`${base}?code=${ACCESS_CODE}`);
  const close = await third.closed;
  expect(third.messages).toEqual([{ type: 'rejected', reason: 'too many concurrent sessions' }]);
  expect(close.code).toBe(4429);

  await Promise.all([first.end(), second.end()]);
});

it('admits a new session once an earlier one has ended', async () => {
  const { client } = fakeClient();
  attachSessions(server, { ...deps, client, limits: { maxConcurrent: 1 } });
  const first = new Recorder(`${base}?code=${ACCESS_CODE}`);
  await first.opened;
  await first.end();

  const second = new Recorder(`${base}?code=${ACCESS_CODE}`);
  await second.opened;
  expect(second.messages).toEqual([]);
  await second.end();
});

it('sends a WebSocket ping on the configured keepalive interval', async () => {
  const { client } = fakeClient();
  const limits: Partial<SessionLimits> = { keepaliveMs: 30, capMs: 10_000, warnBeforeMs: 100 };
  attachSessions(server, { ...deps, client, limits });
  const rec = new Recorder(`${base}?code=${ACCESS_CODE}`);
  await rec.opened;
  let pings = 0;
  rec.socket.on('ping', () => pings++);
  await wait(110);
  expect(pings).toBeGreaterThanOrEqual(2);
  await rec.end();
});

it('plays a warning before the session cap, then closes cleanly at the cap', async () => {
  const { client } = fakeClient();
  const warning = Buffer.alloc(320, 1);
  const expired = Buffer.alloc(320, 2);
  const limits: Partial<SessionLimits> = { capMs: 120, warnBeforeMs: 60, keepaliveMs: 10_000 };
  attachSessions(server, { ...deps, client, notices: { warning, expired }, limits });
  const rec = new Recorder(`${base}?code=${ACCESS_CODE}`);

  const close = await rec.closed;
  expect(rec.messages).toContainEqual({ type: 'turn', index: -1 });
  expect(rec.messages).toContainEqual({ type: 'turn', index: -2 });
  expect(rec.frames).toContainEqual(warning);
  expect(rec.frames).toContainEqual(expired);
  expect(close.code).not.toBe(1011);
});

it('ignores a text frame that is not JSON, and still ends the session cleanly', async () => {
  const { client } = fakeClient();
  attachSessions(server, { ...deps, client });
  const rec = new Recorder(`${base}?code=${ACCESS_CODE}`);
  await rec.opened;
  rec.socket.send('not json');
  await rec.end();
  expect(rec.messages).toContainEqual(expect.objectContaining({ type: 'trace' }));
});

it('sends the finished trace itself with where it landed, so a remote caller can check it', async () => {
  const { client } = fakeClient();
  attachSessions(server, { ...deps, client });
  const rec = new Recorder(`${base}?code=${ACCESS_CODE}`);
  await rec.end();
  const message = rec.messages.find((m) => (m as { type: string }).type === 'trace') as {
    path: string;
    trace: { session_id: string; front_door: string };
  };
  expect(message.path).toBe('traces/fake.json');
  expect(message.trace.front_door).toBe('softphone');
  expect(message.trace.session_id).toEqual(expect.any(String));
});
