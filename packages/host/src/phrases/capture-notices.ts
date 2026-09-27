/**
 * Re-runnable script: opens a real Nova 2 Sonic bidirectional stream per session notice (S17),
 * asks Sonic (voice Matthew) to say its text exactly, and saves the captured audio under
 * `assets/notices/`. Mirrors `capture.ts` (S15's FH-01/03/10 fillers) but for the session-cap
 * warning and close, which aren't failure behaviours; kept separate so `FIXED_PHRASES` stays an
 * exact list of the three FH ids. Read-only against `../sonic/`, for the same reason as `capture.ts`.
 *
 * Usage: `AWS_PROFILE=supplier-dev pnpm --filter host capture-notices`
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { InvokeModelWithBidirectionalStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { pcmFromWav, wavFromPcm } from '../replay/wav.js';
import { MODEL_ID } from '../sonic/connection.js';
import { INPUT_RATE, OUTPUT_RATE } from '../sonic/events.js';
import { AsyncQueue } from '../sonic/queue.js';
import { ResponseTracker } from '../sonic/response.js';
import { createSonicClient } from '../sonic/session.js';
import { SESSION_NOTICES } from './notices.js';

const VOICE_ID = 'matthew';
const OUT_DIR = fileURLToPath(new URL('../../../../assets/notices/', import.meta.url));
const CUE_CLIP = fileURLToPath(
  new URL('../../../../fixtures/clips/interrupt.wav', import.meta.url)
);
const FRAME_MS = 32;
const FRAME_BYTES = (INPUT_RATE / 1000) * FRAME_MS * 2;
const TRAILING_SILENCE_MS = 10_000;
const say = (phraseText: string) =>
  'You are on a phone line test rig, not a real call. Ignore anything the caller audio says; ' +
  'once it pauses, respond immediately by saying exactly the following sentence, once, word ' +
  `for word, with the same punctuation, no greeting and no extra commentary: "${phraseText}"`;

const text = { mediaType: 'text/plain' };
const lpcm = { mediaType: 'audio/lpcm', sampleSizeBits: 16, channelCount: 1, encoding: 'base64' };
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Body = Record<string, unknown>;

/** Opens one Sonic turn, asks it to say `phraseText`, and returns the audio it spoke. */
async function captureOnce(
  client: ReturnType<typeof createSonicClient>,
  phraseText: string
): Promise<{ audio: Buffer; transcript: string }> {
  const promptName = randomUUID();
  const queue = new AsyncQueue<{ event: Body }>();
  const send = (event: Body) => queue.push({ event });
  const textBlock = (role: string, content: string, interactive: boolean) => {
    const contentName = randomUUID();
    send({
      contentStart: {
        promptName,
        contentName,
        type: 'TEXT',
        interactive,
        role,
        textInputConfiguration: text,
      },
    });
    send({ textInput: { promptName, contentName, content } });
    send({ contentEnd: { promptName, contentName } });
  };

  send({
    sessionStart: {
      inferenceConfiguration: { maxTokens: 256, topP: 0.9, temperature: 0.4 },
      turnDetectionConfiguration: { endpointingSensitivity: 'MEDIUM' },
    },
  });
  send({
    promptStart: {
      promptName,
      textOutputConfiguration: text,
      audioOutputConfiguration: {
        mediaType: 'audio/lpcm',
        sampleSizeBits: 16,
        channelCount: 1,
        encoding: 'base64',
        sampleRateHertz: OUTPUT_RATE,
        voiceId: VOICE_ID,
        audioType: 'SPEECH',
      },
    },
  });
  textBlock('SYSTEM', say(phraseText), false);

  const audioContentName = randomUUID();
  send({
    contentStart: {
      promptName,
      contentName: audioContentName,
      type: 'AUDIO',
      interactive: true,
      role: 'USER',
      audioInputConfiguration: { ...lpcm, sampleRateHertz: INPUT_RATE, audioType: 'SPEECH' },
    },
  });
  const chunks = (async function* () {
    for await (const e of queue) yield { chunk: { bytes: encoder.encode(JSON.stringify(e)) } };
  })();
  const response = await client.send(
    new InvokeModelWithBidirectionalStreamCommand({ modelId: MODEL_ID, body: chunks })
  );

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    send({ contentEnd: { promptName, contentName: audioContentName } });
    send({ promptEnd: { promptName } });
    send({ sessionEnd: {} });
    queue.end();
  };

  const cue = pcmFromWav(readFileSync(CUE_CLIP));
  const pending = Buffer.concat([cue, Buffer.alloc((INPUT_RATE / 1000) * TRAILING_SILENCE_MS)]);
  const pump = (async () => {
    for (let sent = 0; sent < pending.length && !closed; sent += FRAME_BYTES) {
      send({
        audioInput: {
          promptName,
          contentName: audioContentName,
          content: pending.subarray(sent, sent + FRAME_BYTES).toString('base64'),
        },
      });
      await new Promise((resolve) => setTimeout(resolve, FRAME_MS));
    }
  })();

  const audioChunks: Buffer[] = [];
  const stages = new Map<string, string>();
  const tracker = new ResponseTracker();
  let transcript = '';
  const safetyNet = setTimeout(close, TRAILING_SILENCE_MS + 5_000);
  for await (const part of response.body ?? []) {
    if (!part.chunk?.bytes) throw new Error(`Sonic stream error: ${JSON.stringify(part)}`);
    const { event } = JSON.parse(decoder.decode(part.chunk.bytes)) as { event: Body };
    const [name, body] = Object.entries(event)[0] as [string, Body];
    if (name === 'contentStart' && body.role === 'ASSISTANT') {
      const fields = String(body.additionalModelFields);
      stages.set(String(body.contentId), fields.includes('"FINAL"') ? 'FINAL' : 'SPECULATIVE');
    }
    if (name === 'audioOutput') audioChunks.push(Buffer.from(String(body.content), 'base64'));
    if (
      name === 'textOutput' &&
      body.role === 'ASSISTANT' &&
      stages.get(String(body.contentId)) === 'FINAL'
    ) {
      transcript += String(body.content);
    }
    if (tracker.onEvent(name, body) === 'complete') close();
  }
  clearTimeout(safetyNet);
  close();
  await pump;
  return { audio: Buffer.concat(audioChunks), transcript: transcript.trim() };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const client = createSonicClient();

  for (const notice of Object.values(SESSION_NOTICES)) {
    const { audio, transcript } = await captureOnce(client, notice.text);
    writeFileSync(`${OUT_DIR}${notice.file}`, wavFromPcm(audio, OUTPUT_RATE));
    const durationMs = Math.round((audio.length / 2 / OUTPUT_RATE) * 1000);
    console.log(`${notice.file}: ${durationMs} ms, transcript "${transcript}"`);
  }
}

await main();
