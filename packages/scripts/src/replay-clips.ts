/**
 * Caller-clip player: runs the five short scenarios and one long scenario from H1's clips against
 * a local or deployed host, writing a trace per scenario and reporting pass/fail. `--url` accepts
 * either a full `ws(s)://.../ws` endpoint or a bare `http(s)://` site URL, which is normalised to
 * its `/ws` WebSocket route. `DEMO_ACCESS_CODE`, when set, is sent as a `code` query parameter,
 * ready for the host to check once S17 lands.
 * Usage: `pnpm --filter scripts run replay-clips -- --url <url> --out <dir> [--long-seconds n]`.
 */
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { pcmFromWav, wavFromPcm } from 'host/src/replay/wav.js';
import { runClip, type RunClipResult } from 'host/src/replay/session.js';
import { getPoStatus } from 'tools/src/po-status/index.js';
import { OUTPUT_RATE } from 'host/src/sonic/events.js';

const CLIPS_DIR = new URL('../../../fixtures/clips/', import.meta.url);
const loadClip = (name: string) => pcmFromWav(readFileSync(new URL(name, CLIPS_DIR)));

function wsUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.pathname === '' || url.pathname === '/') url.pathname = '/ws';
  return url.toString();
}

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'ws://127.0.0.1:8080/ws' },
    out: { type: 'string', default: 'traces/live' },
    'long-seconds': { type: 'string', default: '180' },
  },
});
const url = wsUrl(values.url);
const outDir = values.out;
const longSeconds = Number(values['long-seconds']);
const accessCode = process.env.DEMO_ACCESS_CODE;

interface Scenario {
  name: string;
  sequence: Buffer[];
  interruptAfterMs?: number;
  loopForMs?: number;
  check(
    result: RunClipResult
  ): { pass: boolean; detail: string } | Promise<{ pass: boolean; detail: string }>;
}

const assistantText = (result: RunClipResult) =>
  result.transcript
    .filter((t) => t.role === 'ASSISTANT')
    .map((t) => t.text)
    .join(' ');

async function renderingCheck(poCode: string, result: RunClipResult) {
  const expected = (await getPoStatus({ po_code: poCode })).rendering;
  const heard = assistantText(result);
  const pass = heard.includes(expected);
  return {
    pass,
    detail: pass ? 'rendering spoken exactly' : `expected "${expected}" in "${heard}"`,
  };
}

const tracePassCheck = (result: RunClipResult) => ({
  pass: result.tracePath !== undefined,
  detail: result.tracePath ? 'trace written' : 'no trace written',
});

const poStatusA = loadClip('po-status-a.wav');
const poStatusB = loadClip('po-status-b.wav');
const followupDelivery = loadClip('followup-delivery.wav');
const interruptClip = loadClip('interrupt.wav');
const silence = loadClip('silence-3s.wav');

const shortScenarios: Scenario[] = [
  {
    name: 'po-status-a',
    sequence: [poStatusA],
    check: (result) => renderingCheck('PO-10482', result),
  },
  {
    name: 'po-status-b',
    sequence: [poStatusB],
    check: (result) => renderingCheck('PO-20931', result),
  },
  {
    name: 'barge-in',
    sequence: [poStatusA],
    interruptAfterMs: 1500,
    check: (result) => ({
      pass: result.flushCount >= 1,
      detail: `flush count ${result.flushCount}`,
    }),
  },
  {
    name: 'follow-up-delivery',
    sequence: [poStatusA, followupDelivery],
    check: async (result) => {
      const rendering = await renderingCheck('PO-10482', result);
      const turns = result.transcript.filter((t) => t.role === 'ASSISTANT').length;
      return {
        pass: rendering.pass && turns >= 2,
        detail: `${rendering.detail}; assistant turns ${turns}`,
      };
    },
  },
  { name: 'silence', sequence: [silence], check: tracePassCheck },
];

const longScenario: Scenario = {
  name: 'long-repeat',
  sequence: [poStatusA, followupDelivery],
  loopForMs: longSeconds * 1000,
  check: tracePassCheck,
};

async function runScenario(scenario: Scenario): Promise<boolean> {
  console.log(`\n=== ${scenario.name} ===`);
  const result = await runClip({
    url,
    sequence: scenario.sequence,
    interruptClip: scenario.interruptAfterMs === undefined ? undefined : interruptClip,
    interruptAfterMs: scenario.interruptAfterMs,
    loopForMs: scenario.loopForMs,
    accessCode,
    onLog: (line) => console.log(line),
  });
  await mkdir(outDir, { recursive: true });
  if (result.agentAudio.length > 0) {
    await writeFile(
      join(outDir, `${scenario.name}.agent.wav`),
      wavFromPcm(result.agentAudio, OUTPUT_RATE)
    );
  }
  const { pass, detail } = await scenario.check(result);
  console.log(`trace: ${result.tracePath ?? 'none written'}`);
  console.log(`${pass ? 'PASS' : 'FAIL'} ${scenario.name}: ${detail}`);
  return pass;
}

const results: { name: string; pass: boolean }[] = [];
for (const scenario of [...shortScenarios, longScenario]) {
  const pass = await runScenario(scenario);
  results.push({ name: scenario.name, pass });
}

console.log('\n=== summary ===');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}`);
await writeFile(join(outDir, 'report.json'), JSON.stringify(results, null, 2));

if (results.some((r) => !r.pass)) process.exit(1);
