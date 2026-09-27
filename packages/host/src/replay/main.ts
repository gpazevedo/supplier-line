/**
 * Minimal replay: streams one caller clip in real time to the host's `/ws`, plays the agent audio
 * on a wall clock that reports what played and honours `flush`, keeps sending silence until the
 * answer has finished playing, then prints the transcript beside the expected rendering. With
 * `--interrupt-after <ms>` it sends `fixtures/clips/interrupt.wav` that long into the answer. With
 * `--loop <s>` it alternates the clip with `followup-delivery.wav` for that long, each clip once the
 * previous answer has played and gone quiet.
 * Usage: `pnpm --filter host replay <clip.wav> [PO-code] [--interrupt-after ms] [--loop s] [--url ws-url]`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { getPoStatus } from 'tools/src/po-status/index.js';
import { WebSocket } from 'ws';
import type { HostMessage } from '../sessions.js';
import { INPUT_RATE, OUTPUT_RATE } from '../sonic/events.js';
import { ReplayPlayer } from './player.js';
import { pcmFromWav, wavFromPcm } from './wav.js';

const FRAME_MS = 32;
const FRAME_BYTES = (INPUT_RATE / 1000) * FRAME_MS * 2;
// Sonic can pause 4–6 s before the last sentence of a long rendering.
const QUIET_AFTER_MS = 8000;
const MAX_MS = 90_000;
const INTERRUPT_CLIP = new URL('../../../../fixtures/clips/interrupt.wav', import.meta.url);
const FOLLOWUP_CLIP = new URL('../../../../fixtures/clips/followup-delivery.wav', import.meta.url);

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string', default: 'ws://127.0.0.1:8080/ws' },
    'interrupt-after': { type: 'string' },
    loop: { type: 'string' },
  },
});
const [clipPath, poCode] = positionals;
const url = values.url;
const interruptAfter = values['interrupt-after'];
const interruptAfterMs = interruptAfter === undefined ? undefined : Number(interruptAfter);
const clip = pcmFromWav(readFileSync(clipPath));
const interruptClip = pcmFromWav(readFileSync(INTERRUPT_CLIP));
const loopMs = Number(values.loop ?? 0) * 1000;
const script = [clip, pcmFromWav(readFileSync(FOLLOWUP_CLIP))];
let clipsSent = 1;
let heardSinceClip = false;
let pending = clip;
const clipSent = () => pending.length === 0;
let answerStartedAt = 0;
let interrupted = false;
const socket = new WebSocket(url);
const player = new ReplayPlayer((message) => socket.send(JSON.stringify(message)));
const agentAudio: Buffer[] = [];
const spoken: string[] = [];
let lastHeardAt = 0;
let tracePath: string | undefined;

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
  if (message.type === 'flush') log(`FLUSH     heard ${player.flush()} ms of the turn`);
  if (message.type !== 'transcript') return;
  if (message.role === 'ASSISTANT') spoken.push(message.text.trim());
  log(`${message.role.padEnd(9)} ${message.text.trim()}`);
});
await new Promise((resolve) => socket.once('open', resolve));

const started = Date.now();
const log = (line: string) =>
  console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(5)}s] ${line}`);
const silence = Buffer.alloc(FRAME_BYTES);
const answered = () => heardSinceClip && player.idle && Date.now() > lastHeardAt + QUIET_AFTER_MS;
const interruptDue = () =>
  interruptAfterMs !== undefined &&
  !interrupted &&
  answerStartedAt > 0 &&
  Date.now() >= answerStartedAt + interruptAfterMs;
for (let frame = 0; ; frame++) {
  player.tick();
  if (interruptDue()) {
    log(`CALLER    (interrupt clip, ${Date.now() - answerStartedAt} ms into the answer)`);
    [pending, interrupted] = [interruptClip, true];
  }
  const done = pending.length === 0 && (interruptAfterMs === undefined || interrupted);
  if (done && answered() && Date.now() - started < loopMs) {
    [pending, heardSinceClip] = [script[clipsSent++ % script.length], false];
    log(`CALLER    (clip ${clipsSent})`);
  } else if ((done && answered()) || Date.now() - started > loopMs + MAX_MS) break;
  socket.send(pending.length ? pending.subarray(0, FRAME_BYTES) : silence);
  pending = pending.subarray(FRAME_BYTES);
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
  const asked = Math.ceil(clipsSent / script.length);
  const exact = heard.split(expected).length - 1;
  console.log(`verdict: rendering spoken exactly ${exact} of ${asked} times asked`);
}
