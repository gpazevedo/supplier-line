/**
 * Minimal replay: streams one caller clip in real time to the host's `/ws` and prints the
 * transcript beside the expected rendering. With `--interrupt-after <ms>` it sends
 * `fixtures/clips/interrupt.wav` that long into the answer. With `--loop <s>` it alternates the
 * clip with `followup-delivery.wav` for that long, each clip once the previous answer has played
 * and gone quiet. Each session writes `traces/<session-id>.json` (set `TRACE_DIR` to change it);
 * this CLI also saves the agent audio beside it as `.agent.wav`.
 * Usage: `pnpm --filter host replay <clip.wav> [PO-code] [--interrupt-after ms] [--loop s] [--url ws-url]`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { getPoStatus } from 'tools/src/po-status/index.js';
import { OUTPUT_RATE } from '../sonic/events.js';
import { runClip } from './session.js';
import { pcmFromWav, wavFromPcm } from './wav.js';

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
const interruptAfter = values['interrupt-after'];
const interruptAfterMs = interruptAfter === undefined ? undefined : Number(interruptAfter);
const clip = pcmFromWav(readFileSync(clipPath));
const followup = pcmFromWav(readFileSync(FOLLOWUP_CLIP));

const started = Date.now();
const log = (line: string) =>
  console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(5)}s] ${line}`);

const result = await runClip({
  url: values.url,
  sequence: [clip, followup],
  interruptClip:
    interruptAfterMs === undefined ? undefined : pcmFromWav(readFileSync(INTERRUPT_CLIP)),
  interruptAfterMs,
  loopForMs: Number(values.loop ?? 0) * 1000,
  onLog: log,
});

console.log(`\ntrace: ${result.tracePath ?? 'none written'}`);
if (result.tracePath) {
  const wavPath = result.tracePath.replace(/\.json$/, '.agent.wav');
  writeFileSync(wavPath, wavFromPcm(result.agentAudio, OUTPUT_RATE));
  console.log(`agent audio: ${wavPath}`);
}
if (poCode) {
  const expected = (await getPoStatus({ po_code: poCode })).rendering;
  const spoken = result.transcript.filter((t) => t.role === 'ASSISTANT').map((t) => t.text);
  const heard = spoken.join(' ');
  console.log(`\nexpected rendering: ${expected}\nspoken transcript:  ${heard}`);
  const asked = Math.ceil(result.turnsSent / 2);
  const exact = heard.split(expected).length - 1;
  console.log(`verdict: rendering spoken exactly ${exact} of ${asked} times asked`);
}
