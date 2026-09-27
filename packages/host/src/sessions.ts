import type { Server } from 'node:http';
import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import type { TraceWriter } from 'traces/src/index.js';
import { WebSocketServer, type WebSocket } from 'ws';
import { SonicSession } from './sonic/session.js';

/** Messages the host sends as JSON text frames; agent audio goes out as binary frames. */
export type HostMessage =
  | { type: 'transcript'; role: 'USER' | 'ASSISTANT'; text: string }
  | { type: 'trace'; path: string };

export interface SessionDeps {
  client: BedrockRuntimeClient;
  writer: TraceWriter;
}

/**
 * Serves Sonic sessions on `/ws`: binary frames in are 16 kHz caller PCM, binary frames out are
 * 24 kHz agent PCM. A `{"type":"end"}` text frame ends the session, writes its trace and replies
 * with where it landed.
 */
export function attachSessions(server: Server, deps: SessionDeps): void {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (socket) => void serve(socket, deps));
}

async function serve(socket: WebSocket, { client, writer }: SessionDeps): Promise<void> {
  const send = (message: HostMessage) => socket.send(JSON.stringify(message));
  const session = new SonicSession(client, {
    onAudio: (pcm) => socket.send(pcm),
    onTranscript: (role, text) => send({ type: 'transcript', role, text }),
  });
  socket.on('message', (data, isBinary) => {
    if (isBinary) session.sendAudio(data as Buffer);
    else if (JSON.parse(String(data)).type === 'end') session.close();
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
