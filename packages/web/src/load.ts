import { parseTrace, type Trace } from 'traces/src/schema.js';

/** Validates a trace's JSON text with the traces package's schema. */
export function parseTraceText(text: string): Trace {
  return parseTrace(JSON.parse(text));
}

/** Reads and validates one picked or dropped file; the error names the file. */
export async function loadFile(file: File): Promise<Trace> {
  try {
    return parseTraceText(await file.text());
  } catch (error) {
    throw new Error(`${file.name}: ${error instanceof Error ? error.message : error}`, {
      cause: error,
    });
  }
}
