import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { pcmFromWav, wavFromPcm } from './wav.js';

it('round-trips PCM through a 16 kHz mono WAV', () => {
  const pcm = Buffer.from([1, 0, 2, 0, 3, 0]);
  expect(pcmFromWav(wavFromPcm(pcm, 16_000))).toEqual(pcm);
});

it('reads the committed PO clip as 16 kHz mono PCM', () => {
  const wav = readFileSync(new URL('../../../../fixtures/clips/po-status-a.wav', import.meta.url));
  expect(pcmFromWav(wav).length).toBeGreaterThan(16_000 * 2);
});

it('rejects a WAV that is not 16 kHz 16-bit mono', () => {
  const wav = wavFromPcm(Buffer.alloc(4), 24_000);
  expect(() => pcmFromWav(wav)).toThrow(/16 kHz/);
});
