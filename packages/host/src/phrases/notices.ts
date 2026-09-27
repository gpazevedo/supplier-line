import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SessionNotices } from '../sessions.js';

const NOTICES_DIR = fileURLToPath(new URL('../../../../assets/notices/', import.meta.url));

/** Text spoken by each notice; captured to WAV by `pnpm --filter host capture-notices`. */
export const SESSION_NOTICES = {
  warning: { file: 'one-minute-warning.wav', text: 'One minute left on this call.' },
  expired: {
    file: 'session-expired.wav',
    text: 'This call has reached its time limit now. Goodbye.',
  },
};

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

/** Loads the session-cap notices captured under `assets/notices/`. */
export function loadSessionNotices(): SessionNotices {
  return {
    warning: pcmFromWav(readFileSync(`${NOTICES_DIR}${SESSION_NOTICES.warning.file}`)),
    expired: pcmFromWav(readFileSync(`${NOTICES_DIR}${SESSION_NOTICES.expired.file}`)),
  };
}
