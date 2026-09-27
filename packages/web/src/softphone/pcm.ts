/** Converts 16-bit little-endian PCM to float samples in [-1, 1). */
export function floatFromPcm16(pcm: Uint8Array): Float32Array {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  return Float32Array.from(
    { length: pcm.byteLength / 2 },
    (_, i) => view.getInt16(i * 2, true) / 32768
  );
}

/** Converts float samples to 16-bit little-endian PCM, clipping to the 16-bit range. */
export function pcm16FromFloat(samples: Float32Array): Uint8Array<ArrayBuffer> {
  const pcm = new Uint8Array(samples.length * 2);
  const view = new DataView(pcm.buffer);
  samples.forEach((s, i) =>
    view.setInt16(i * 2, Math.max(-32768, Math.min(32767, Math.round(s * 32768))), true)
  );
  return pcm;
}
