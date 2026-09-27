/**
 * Minimal replay: streams one caller clip in real time to the host's `/ws`, keeps sending silence
 * until the agent's answer has finished playing, then prints the transcript beside the expected
 * rendering. Usage: `pnpm --filter host replay <clip.wav> [PO-code] [ws-url]`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { getPoStatus } from 'tools/src/po-status/index.js';
import { WebSocket } from 'ws';
import type { HostMessage } from '../sessions.js';
import { INPUT_RATE, OUTPUT_RATE } from '../sonic/events.js';
import { PlaybackClock } from './playback-clock.js';
import { pcmFromWav, wavFromPcm } from './wav.js';

const FRAME_MS = 32;
const FRAME_BYTES = (INPUT_RATE / 1000) * FRAME_MS * 2;
const QUIET_AFTER_MS = 4000;
const MAX_MS = 90_000;

const [clipPath, poCode, url = 'ws://127.0.0.1:8080/ws'] = process.argv.slice(2);
const clip = pcmFromWav(readFileSync(clipPath));
const socket = new WebSocket(url);
const clock = new PlaybackClock(OUTPUT_RATE);
const agentAudio: Buffer[] = [];
const spoken: string[] = [];
let lastTextAt = 0;
let tracePath: string | undefined;

socket.on('message', (data, isBinary) => {
  if (isBinary) {
    clock.add((data as Buffer).length, Date.now());
    agentAudio.push(data as Buffer);
    return;
  }
  const message = JSON.parse(String(data)) as HostMessage;
  if (message.type === 'trace') tracePath = message.path;
  if (message.type !== 'transcript') return;
  lastTextAt = Date.now();
  if (message.role === 'ASSISTANT') spoken.push(message.text.trim());
  console.log(`${message.role.padEnd(9)} ${message.text.trim()}`);
});
await new Promise((resolve) => socket.once('open', resolve));

const started = Date.now();
const silence = Buffer.alloc(FRAME_BYTES);
const answered = () =>
  clock.endsAt > 0 && Date.now() > Math.max(clock.endsAt, lastTextAt) + QUIET_AFTER_MS;
for (let frame = 0; ; frame++) {
  const offset = frame * FRAME_BYTES;
  const clipDone = offset >= clip.length;
  if ((clipDone && answered()) || Date.now() - started > MAX_MS) break;
  socket.send(clipDone ? silence : clip.subarray(offset, offset + FRAME_BYTES));
  await sleep(started + (frame + 1) * FRAME_MS - Date.now());
}

socket.send(JSON.stringify({ type: 'end' }));
await new Promise((resolve) => socket.once('close', resolve));

console.log(`\ntrace: ${tracePath ?? 'none written'}`);
if (tracePath) {
  const wavPath = tracePath.replace(/\.json$/, '.agent.wav');
  writeFileSync(wavPath, wavFromPcm(Buffer.concat(agentAudio), OUTPUT_RATE));
  console.log(`agent audio: ${wavPath}`);
}
if (poCode) {
  const expected = (await getPoStatus({ po_code: poCode })).rendering;
  const heard = spoken.join(' ');
  console.log(`\nexpected rendering: ${expected}\nspoken transcript:  ${heard}`);
  console.log(`verdict: ${heard.includes(expected) ? 'rendering spoken exactly' : 'MISMATCH'}`);
}
