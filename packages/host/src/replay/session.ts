/**
 * Streams a sequence of caller clips in real time to the host's `/ws`, plays the agent audio on a
 * wall clock that reports what played and honours `flush`, and keeps sending silence until each
 * answer has finished playing before sending the next clip in the sequence. Shared by the `replay`
 * CLI (one clip, optionally looped) and the scripted caller-clip player (fixed scenarios).
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';
import type { HostMessage } from '../sessions.js';
import { INPUT_RATE } from '../sonic/events.js';
import { ReplayPlayer } from './player.js';

const FRAME_MS = 32;
const FRAME_BYTES = (INPUT_RATE / 1000) * FRAME_MS * 2;
// Sonic can pause 4-6 s before the last sentence of a long rendering.
const QUIET_AFTER_MS = 8000;
const MAX_MS = 90_000;

export interface RunClipOptions {
  /** WebSocket URL of the host's `/ws` endpoint. */
  url: string;
  /** Caller clips (16 kHz mono PCM) sent one at a time, each once the previous answer is quiet. */
  sequence: Buffer[];
  /** Sent this long after the first turn's agent audio begins, once. */
  interruptClip?: Buffer;
  interruptAfterMs?: number;
  /** Once `sequence` is exhausted, keep cycling through it until this many ms have elapsed. */
  loopForMs?: number;
  /** Query parameter carrying the demo access code, once the host checks one (S17). */
  accessCode?: string;
  onLog?: (line: string) => void;
}

export interface RunClipResult {
  tracePath?: string;
  agentAudio: Buffer;
  /** Trimmed transcript text, in order, prefixed by role. */
  transcript: { role: 'USER' | 'ASSISTANT'; text: string }[];
  flushCount: number;
  /** Total clips sent from `sequence`, counting repeats once looped. */
  turnsSent: number;
}

function withAccessCode(url: string, accessCode: string | undefined): string {
  if (!accessCode) return url;
  const withCode = new URL(url);
  withCode.searchParams.set('code', accessCode);
  return withCode.toString();
}

/** Runs one session against the host and resolves once the sequence is answered and the socket closes. */
export async function runClip(options: RunClipOptions): Promise<RunClipResult> {
  const log = options.onLog ?? (() => undefined);
  const socket = new WebSocket(withAccessCode(options.url, options.accessCode));
  const player = new ReplayPlayer((message) => socket.send(JSON.stringify(message)));
  const agentAudio: Buffer[] = [];
  const transcript: RunClipResult['transcript'] = [];
  let tracePath: string | undefined;
  let flushCount = 0;
  let lastHeardAt = 0;
  let heardSinceClip = false;
  let answerStartedAt = 0;
  let interrupted = false;
  let turnsSent = 1;
  let pending = options.sequence[0] ?? Buffer.alloc(0);
  const clipSent = () => pending.length === 0;

  socket.on('message', (data, isBinary) => {
    lastHeardAt = Date.now();
    if (isBinary) {
      if (clipSent()) heardSinceClip = true;
      if (clipSent() && player.idle) answerStartedAt ||= Date.now();
      player.add(data as Buffer);
      agentAudio.push(data as Buffer);
      return;
    }
    const message = JSON.parse(String(data)) as HostMessage;
    if (message.type === 'trace') tracePath = message.path;
    if (message.type === 'turn') player.startTurn(message.index);
    if (message.type === 'flush') {
      flushCount++;
      log(`FLUSH     heard ${player.flush(message.turn)} ms of the turn`);
    }
    if (message.type !== 'transcript') return;
    transcript.push({ role: message.role, text: message.text.trim() });
    log(`${message.role.padEnd(9)} ${message.text.trim()}`);
  });
  await new Promise((resolve) => socket.once('open', resolve));

  const started = Date.now();
  const silence = Buffer.alloc(FRAME_BYTES);
  const loopForMs = options.loopForMs ?? 0;
  const answered = () => heardSinceClip && player.idle && Date.now() > lastHeardAt + QUIET_AFTER_MS;
  const interruptDue = () =>
    options.interruptClip !== undefined &&
    options.interruptAfterMs !== undefined &&
    !interrupted &&
    answerStartedAt > 0 &&
    Date.now() >= answerStartedAt + options.interruptAfterMs;

  for (let frame = 0; ; frame++) {
    player.tick();
    if (interruptDue()) {
      log(`CALLER    (interrupt clip, ${Date.now() - answerStartedAt} ms into the answer)`);
      [pending, interrupted] = [options.interruptClip as Buffer, true];
    }
    const clipDone =
      pending.length === 0 && (options.interruptAfterMs === undefined || interrupted);
    if (clipDone && answered()) {
      const moreInSequence = turnsSent < options.sequence.length;
      const keepLooping = Date.now() - started < loopForMs;
      if (moreInSequence || keepLooping) {
        pending = options.sequence[turnsSent++ % options.sequence.length];
        heardSinceClip = false;
        log(`CALLER    (clip ${turnsSent})`);
      } else break;
    } else if (Date.now() - started > loopForMs + MAX_MS) break;
    socket.send(pending.length ? pending.subarray(0, FRAME_BYTES) : silence);
    pending = pending.subarray(FRAME_BYTES);
    await sleep(started + (frame + 1) * FRAME_MS - Date.now());
  }

  socket.send(JSON.stringify({ type: 'end' }));
  await new Promise((resolve) => socket.once('close', resolve));

  return { tracePath, agentAudio: Buffer.concat(agentAudio), transcript, flushCount, turnsSent };
}
