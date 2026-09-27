import { getPoStatusToolSpec } from 'tools/src/po-status/index.js';
import { SYSTEM_PROMPT } from './prompt.js';

/** One event sent to Nova 2 Sonic, serialised as the JSON of a stream chunk. */
export interface SonicInputEvent {
  event: Record<string, Record<string, unknown>>;
}

/** Stable names for one session: the prompt, the system text block and the caller-audio block. */
export interface SessionIds {
  prompt: string;
  system: string;
  audio: string;
}

const lpcm = { mediaType: 'audio/lpcm', sampleSizeBits: 16, channelCount: 1, encoding: 'base64' };
const text = { mediaType: 'text/plain' };

/** Caller audio rate; the fixtures and the browser both send 16 kHz. */
export const INPUT_RATE = 16_000;
/** Agent audio rate. */
export const OUTPUT_RATE = 24_000;

const ev = (name: string, body: Record<string, unknown>): SonicInputEvent => ({
  event: { [name]: body },
});

/** Session and prompt setup, the system prompt, then the open caller-audio container. */
export function openingEvents(ids: SessionIds): SonicInputEvent[] {
  const promptName = ids.prompt;
  return [
    ev('sessionStart', {
      inferenceConfiguration: { maxTokens: 1024, topP: 0.9, temperature: 0.7 },
      turnDetectionConfiguration: { endpointingSensitivity: 'MEDIUM' },
    }),
    ev('promptStart', {
      promptName,
      textOutputConfiguration: text,
      audioOutputConfiguration: {
        ...lpcm,
        sampleRateHertz: OUTPUT_RATE,
        voiceId: 'matthew',
        audioType: 'SPEECH',
      },
      toolUseOutputConfiguration: { mediaType: 'application/json' },
      toolConfiguration: { tools: [getPoStatusToolSpec] },
    }),
    ev('contentStart', {
      promptName,
      contentName: ids.system,
      type: 'TEXT',
      interactive: false,
      role: 'SYSTEM',
      textInputConfiguration: text,
    }),
    ev('textInput', { promptName, contentName: ids.system, content: SYSTEM_PROMPT }),
    ev('contentEnd', { promptName, contentName: ids.system }),
    ev('contentStart', {
      promptName,
      contentName: ids.audio,
      type: 'AUDIO',
      interactive: true,
      role: 'USER',
      audioInputConfiguration: { ...lpcm, sampleRateHertz: INPUT_RATE, audioType: 'SPEECH' },
    }),
  ];
}

/** One chunk of 16-bit PCM caller audio. */
export function audioInput(ids: SessionIds, pcm: Buffer): SonicInputEvent {
  return ev('audioInput', {
    promptName: ids.prompt,
    contentName: ids.audio,
    content: pcm.toString('base64'),
  });
}

/** A tool result as its own TOOL content block, answering `toolUseId`. */
export function toolResultEvents(
  promptName: string,
  contentName: string,
  toolUseId: string,
  content: string
): SonicInputEvent[] {
  return [
    ev('contentStart', {
      promptName,
      contentName,
      interactive: false,
      type: 'TOOL',
      role: 'TOOL',
      toolResultInputConfiguration: { toolUseId, type: 'TEXT', textInputConfiguration: text },
    }),
    ev('toolResult', { promptName, contentName, content }),
    ev('contentEnd', { promptName, contentName }),
  ];
}

/** Closing sequence: caller audio, prompt, session. */
export function closingEvents(ids: SessionIds): SonicInputEvent[] {
  return [
    ev('contentEnd', { promptName: ids.prompt, contentName: ids.audio }),
    ev('promptEnd', { promptName: ids.prompt }),
    ev('sessionEnd', {}),
  ];
}
