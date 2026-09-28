import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assetsDir } from './assets.js';
import { FIXED_PHRASES, type FixedPhrase } from 'tools/src/phrases/index.js';

const VARIANT = 1;

export interface FixedPhraseAudio {
  text: string;
  /** 24 kHz 16-bit mono PCM. */
  pcm: Buffer;
}

export type FixedPhrases = Record<FixedPhrase['id'], FixedPhraseAudio>;

/** The PCM samples of a WAV file's `data` chunk, at whatever rate it was recorded. */
function pcmFromWav(wav: Buffer): Buffer {
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === 'data') return wav.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}

/** Loads the FH-01/03/10 phrases captured under `assets/phrases/` (S15), variant 1 of each. */
export function loadFixedPhrases(): FixedPhrases {
  return Object.fromEntries(
    FIXED_PHRASES.map((phrase) => [
      phrase.id,
      {
        text: phrase.text,
        pcm: pcmFromWav(readFileSync(join(assetsDir(), 'phrases', `${phrase.id}-${VARIANT}.wav`))),
      },
    ])
  ) as FixedPhrases;
}
