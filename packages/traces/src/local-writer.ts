import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serializeTrace, traceKey, type TraceWriter } from './writer.js';

/** Writes each trace as a JSON file in `dir`, creating the folder if needed. */
export function localTraceWriter(dir: string): TraceWriter {
  return {
    async write(trace) {
      const body = serializeTrace(trace);
      await mkdir(dir, { recursive: true });
      const path = join(dir, traceKey(trace));
      await writeFile(path, body);
      return path;
    },
  };
}
