import { expect, it } from 'vitest';
import { floatFromPcm16, pcm16FromFloat } from './pcm.js';

it('converts 16-bit PCM to floats', () => {
  const pcm = new Uint8Array(new Int16Array([0, 16384, -32768]).buffer);
  expect([...floatFromPcm16(pcm)]).toEqual([0, 0.5, -1]);
});

it('converts floats to 16-bit PCM, clipping out-of-range samples', () => {
  const pcm = pcm16FromFloat(new Float32Array([0, 0.5, -1, 2]));
  expect([...new Int16Array(pcm.buffer)]).toEqual([0, 16384, -32768, 32767]);
});
