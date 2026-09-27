/**
 * Re-runnable script: opens a real Nova 2 Sonic bidirectional stream per phrase variant, asks
 * Sonic (voice Matthew) to say the phrase text exactly, and saves the captured audio under
 * `assets/phrases/` alongside a manifest. Read-only against `../sonic/`: it copies the minimum
 * event shapes it needs rather than importing the live session's event builders, which another
 * stream is editing.
 *
 * Usage: `AWS_PROFILE=supplier-dev pnpm --filter host capture-phrases [variants-per-phrase]`
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { InvokeModelWithBidirectionalStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { FIXED_PHRASES } from 'tools/src/phrases/index.js';
import { pcmFromWav, wavFromPcm } from '../replay/wav.js';
import { MODEL_ID } from '../sonic/connection.js';
import { INPUT_RATE, OUTPUT_RATE } from '../sonic/events.js';
import { AsyncQueue } from '../sonic/queue.js';
import { ResponseTracker } from '../sonic/response.js';
import { createSonicClient } from '../sonic/session.js';

const VOICE_ID = 'matthew';
const VARIANTS = Number(process.argv[2] ?? 3);
const OUT_DIR = fileURLToPath(new URL('../../../../assets/phrases/', import.meta.url));

// Nova 2 Sonic rejects a prompt with no audio content, and needs real (not digital-silent) audio
// paced in real time for its endpointing to notice the caller stopped, so the turn that triggers
// speech is a short recorded cue clip followed by trailing silence; the system prompt (a text
// input) carries the exact words to say back, regardless of what the cue contains.
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
interface ManifestEntry {
  id: string;
  text: string;
  file: string;
  duration_ms: number;
  transcript: string;
}

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
  const manifest: ManifestEntry[] = [];

  for (const phrase of FIXED_PHRASES) {
    for (let variant = 1; variant <= VARIANTS; variant++) {
      const { audio, transcript } = await captureOnce(client, phrase.text);
      const file = `${phrase.id}-${variant}.wav`;
      writeFileSync(`${OUT_DIR}${file}`, wavFromPcm(audio, OUTPUT_RATE));
      const durationMs = Math.round((audio.length / 2 / OUTPUT_RATE) * 1000);
      manifest.push({
        id: phrase.id,
        text: phrase.text,
        file,
        duration_ms: durationMs,
        transcript,
      });
      console.log(`${file}: ${durationMs} ms, transcript "${transcript}"`);
    }
  }

  writeFileSync(`${OUT_DIR}manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nmanifest: ${OUT_DIR}manifest.json`);
}

await main();
