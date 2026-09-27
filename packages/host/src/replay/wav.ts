/** Returns the PCM samples of a 16 kHz, 16-bit, mono WAV; throws on any other format. */
export function pcmFromWav(wav: Buffer): Buffer {
  let offset = 12;
  let format: Buffer | undefined;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const body = wav.subarray(offset + 8, offset + 8 + size);
    if (id === 'fmt ') format = body;
    if (id === 'data') {
      assertFormat(format);
      return body;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}

function assertFormat(format: Buffer | undefined): void {
  const ok =
    format?.readUInt16LE(2) === 1 &&
    format.readUInt32LE(4) === 16_000 &&
    format.readUInt16LE(14) === 16;
  if (!ok) throw new Error('Expected a 16 kHz, 16-bit, mono WAV');
}

/** Wraps 16-bit mono PCM in a WAV header. */
export function wavFromPcm(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
