import type { Server } from 'node:http';
import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import type { Trace, TraceWriter } from 'traces/src/index.js';
import { WebSocketServer, type WebSocket } from 'ws';
import type { FixedPhrases } from './phrases/fixed.js';
import { OUTPUT_RATE } from './sonic/events.js';
import type { RotatorOptions } from './sonic/rotator.js';
import { SonicSession, type SessionFault } from './sonic/session.js';

/**
 * Messages the host sends as JSON text frames; agent audio goes out as binary frames. `ready`
 * means Sonic is listening: caller audio sent before it is dropped, so a client starts the caller
 * speaking only after it. A `turn`
 * marker precedes the first audio of each turn; `flush` means drop all queued agent audio, and
 * names the interrupted turn, which may not have sent any audio yet. `trace` carries the finished
 * session's own trace and where it was written, so a remote caller (the live smoke job) can check
 * it without AWS access. `rejected` is sent just before the socket closes without a session ever
 * starting (S17).
 */
export type HostMessage =
  | { type: 'ready' }
  | { type: 'transcript'; role: 'USER' | 'ASSISTANT'; text: string }
  | { type: 'turn'; index: number }
  | { type: 'flush'; turn?: number }
  | { type: 'trace'; path: string; trace: Trace }
  | { type: 'rejected'; reason: string };

/**
 * Messages the client sends as JSON text frames: running totals of milliseconds played per turn,
 * the total left once it flushed after a barge-in, and the end of the session.
 */
export type ClientMessage =
  | { type: 'played'; turn: number; ms: number }
  | { type: 'flushed'; turn: number; ms: number }
  | { type: 'end' };

/** Pre-recorded phrases played directly on the socket, bypassing Sonic, for the session-cap warning and close (S17). */
export interface SessionNotices {
  warning: Buffer;
  expired: Buffer;
}

export interface SessionLimits {
  /** Sessions refused past this count; a WebSocket close code 4429 names the reason. */
  maxConcurrent: number;
  /** Session lifetime; at this point the session is closed after `expired` plays. */
  capMs: number;
  /** How long before the cap `warning` plays. */
  warnBeforeMs: number;
  /** How often a WebSocket ping keeps the connection alive through the ALB and CloudFront. */
  keepaliveMs: number;
}

export const DEFAULT_LIMITS: SessionLimits = {
  maxConcurrent: 2,
  capMs: 15 * 60_000,
  warnBeforeMs: 60_000,
  keepaliveMs: 20_000,
};

export interface SessionDeps {
  client: BedrockRuntimeClient;
  writer: TraceWriter;
  rotation: RotatorOptions;
  /** Checked against the `code` query parameter on connect; wrong or missing is rejected first. */
  accessCode: string;
  notices: SessionNotices;
  /** The captured FH-01/03/10 audio and text (S15), played for their failure behaviours. */
  phrases: FixedPhrases;
  limits?: Partial<SessionLimits>;
}

/** Turn indices used for notice audio, well outside the range of real (non-negative) Sonic turns. */
const WARNING_TURN = -1;
const EXPIRED_TURN = -2;

/**
 * Demo-only fault flag, `?fault=fh01|fh03|fh10` on `/ws` (never enabled by default): forces one of
 * the three failure behaviours to trigger reliably, instead of waiting for a real stream-open
 * failure or a slow lookup. `fh01` makes the Sonic stream fail to open, without any real Bedrock
 * call. `fh03` holds the session's first turn's real agent audio back for `FAULT_HOLD_AUDIO_MS`,
 * so the stall (and hence the filler) happens regardless of what Sonic says or how fast the
 * lookup is; Sonic sometimes speaks something (e.g. "Let me check that.") well inside the 1.5 s
 * stall window on its own, which used to make the flag unreliable. `fh10` makes the session's
 * first `get_po_status` call wait `FAULT_TOOL_DELAY_MS`, past the tool timeout, so the first
 * attempt times out and the (undelayed) retry answers normally.
 */
const FAULT_HOLD_AUDIO_MS = 1800;
const FAULT_TOOL_DELAY_MS = 4000;

function faultFor(flag: string | null): SessionFault {
  if (flag === 'fh03') return { holdAudioMs: FAULT_HOLD_AUDIO_MS };
  if (flag === 'fh10') return { toolDelayMs: FAULT_TOOL_DELAY_MS };
  return {};
}

/** A client whose stream never opens, for the `fault=fh01` flag; makes no real Bedrock call. */
function failingClient(): BedrockRuntimeClient {
  const send = () => Promise.reject(new Error('FH-01 fault flag: stream open forced to fail'));
  return { send } as unknown as BedrockRuntimeClient;
}

/**
 * Serves Sonic sessions on `/ws`: binary frames in are 16 kHz caller PCM, binary frames out are
 * 24 kHz agent PCM. Text frames carry `HostMessage` out and `ClientMessage` in; `end` ends the
 * session, writes its trace and replies with where it landed.
 *
 * Before any session starts: the `code` query parameter must match `accessCode`, and at most
 * `limits.maxConcurrent` sessions may be open at once. Both checks happen before any Bedrock call.
 */
export function attachSessions(server: Server, deps: SessionDeps): void {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const limits = { ...DEFAULT_LIMITS, ...deps.limits };
  let active = 0;
  wss.on('connection', (socket, request) => {
    const params = new URL(request.url ?? '', 'http://host').searchParams;
    const code = params.get('code');
    if (code === null) return reject(socket, 4401, 'missing access code');
    if (code !== deps.accessCode) return reject(socket, 4401, 'wrong access code');
    if (active >= limits.maxConcurrent) return reject(socket, 4429, 'too many concurrent sessions');
    active++;
    void serve(socket, deps, limits, params.get('fault')).finally(() => {
      active--;
    });
  });
}

function reject(socket: WebSocket, code: number, reason: string): void {
  socket.send(JSON.stringify({ type: 'rejected', reason } satisfies HostMessage));
  socket.close(code, reason);
}

/** A client text frame, or undefined if it isn't JSON: a bad frame must not crash every session. */
function parseClientMessage(text: string): ClientMessage | undefined {
  try {
    return JSON.parse(text) as ClientMessage;
  } catch {
    return undefined;
  }
}

/** Milliseconds of 24 kHz 16-bit mono PCM. */
function durationMs(pcm: Buffer): number {
  return Math.round(pcm.length / 2 / (OUTPUT_RATE / 1000));
}

async function serve(
  socket: WebSocket,
  { client, writer, rotation, notices, phrases }: SessionDeps,
  limits: SessionLimits,
  faultFlag: string | null
): Promise<void> {
  const send = (message: HostMessage) => socket.send(JSON.stringify(message));
  let audioTurn: number | undefined;
  const fault = faultFor(faultFlag);
  const session = new SonicSession(
    faultFlag === 'fh01' ? failingClient() : client,
    {
      onAudio: (pcm, turn) => {
        if (turn !== undefined && turn !== audioTurn) send({ type: 'turn', index: turn });
        audioTurn = turn;
        socket.send(pcm);
      },
      onInterrupted: (turn) => send({ type: 'flush', turn }),
      onTranscript: (role, text) => send({ type: 'transcript', role, text }),
      onReady: () => send({ type: 'ready' }),
    },
    rotation,
    { phrases, fault }
  );

  /** Plays a notice directly on the socket; a fresh `turn` frame follows once Sonic next speaks. */
  const notify = (pcm: Buffer, turn: number) => {
    send({ type: 'turn', index: turn });
    socket.send(pcm);
    audioTurn = turn;
  };

  const keepalive = setInterval(() => {
    if (socket.readyState === socket.OPEN) socket.ping();
  }, limits.keepaliveMs);
  const warned = setTimeout(
    () => notify(notices.warning, WARNING_TURN),
    Math.max(0, limits.capMs - limits.warnBeforeMs)
  );
  const expired = setTimeout(() => {
    notify(notices.expired, EXPIRED_TURN);
    setTimeout(() => session.close(), durationMs(notices.expired));
  }, limits.capMs);
  const stopTimers = () => {
    clearInterval(keepalive);
    clearTimeout(warned);
    clearTimeout(expired);
  };

  socket.on('message', (data, isBinary) => {
    if (isBinary) return session.sendAudio(data as Buffer);
    const message = parseClientMessage(String(data));
    if (!message) return;
    if (message.type === 'played' && message.turn >= 0) session.onPlayed(message.turn, message.ms);
    if (message.type === 'flushed' && message.turn >= 0)
      session.onFlushed(message.turn, message.ms);
    if (message.type === 'end') session.close();
  });
  socket.on('close', () => session.close());
  try {
    await session.run();
    stopTimers();
    const trace = session.trace();
    send({ type: 'trace', path: await writer.write(trace), trace });
    socket.close();
  } catch (error) {
    stopTimers();
    console.error(`session ${session.id} failed`, error);
    socket.close(1011, 'session failed');
  }
}
