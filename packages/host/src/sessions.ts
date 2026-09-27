import type { Server } from 'node:http';
import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import type { TraceWriter } from 'traces/src/index.js';
import { WebSocketServer, type WebSocket } from 'ws';
import type { RotatorOptions } from './sonic/rotator.js';
import { SonicSession } from './sonic/session.js';

/**
 * Messages the host sends as JSON text frames; agent audio goes out as binary frames. A `turn`
 * marker precedes the first audio of each turn; `flush` means drop all queued agent audio.
 */
export type HostMessage =
  | { type: 'transcript'; role: 'USER' | 'ASSISTANT'; text: string }
  | { type: 'turn'; index: number }
  | { type: 'flush' }
  | { type: 'trace'; path: string };

/**
 * Messages the client sends as JSON text frames: running totals of milliseconds played per turn,
 * the total left once it flushed after a barge-in, and the end of the session.
 */
export type ClientMessage =
  | { type: 'played'; turn: number; ms: number }
  | { type: 'flushed'; turn: number; ms: number }
  | { type: 'end' };

export interface SessionDeps {
  client: BedrockRuntimeClient;
  writer: TraceWriter;
  rotation: RotatorOptions;
}

/**
 * Serves Sonic sessions on `/ws`: binary frames in are 16 kHz caller PCM, binary frames out are
 * 24 kHz agent PCM. Text frames carry `HostMessage` out and `ClientMessage` in; `end` ends the
 * session, writes its trace and replies with where it landed.
 */
export function attachSessions(server: Server, deps: SessionDeps): void {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (socket) => void serve(socket, deps));
}

async function serve(socket: WebSocket, { client, writer, rotation }: SessionDeps): Promise<void> {
  const send = (message: HostMessage) => socket.send(JSON.stringify(message));
  let audioTurn: number | undefined;
  const session = new SonicSession(
    client,
    {
      onAudio: (pcm, turn) => {
        if (turn !== undefined && turn !== audioTurn) send({ type: 'turn', index: turn });
        audioTurn = turn;
        socket.send(pcm);
      },
      onInterrupted: () => send({ type: 'flush' }),
      onTranscript: (role, text) => send({ type: 'transcript', role, text }),
    },
    rotation
  );
  socket.on('message', (data, isBinary) => {
    if (isBinary) return session.sendAudio(data as Buffer);
    const message = JSON.parse(String(data)) as ClientMessage;
    if (message.type === 'played') session.onPlayed(message.turn, message.ms);
    if (message.type === 'flushed') session.onFlushed(message.turn, message.ms);
    if (message.type === 'end') session.close();
  });
  socket.on('close', () => session.close());
  try {
    await session.run();
    send({ type: 'trace', path: await writer.write(session.trace()) });
    socket.close();
  } catch (error) {
    console.error(`session ${session.id} failed`, error);
    socket.close(1011, 'session failed');
  }
}
