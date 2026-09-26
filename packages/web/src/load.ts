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

/** The host's GET /api/traces: a JSON array of trace ids. */
export async function listHostTraces(): Promise<string[]> {
  const response = await fetch('/api/traces');
  if (!response.ok) throw new Error(`GET /api/traces returned ${response.status}`);
  return response.json();
}

/** The host's GET /api/traces/:id. */
export async function loadHostTrace(id: string): Promise<Trace> {
  const response = await fetch(`/api/traces/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`GET /api/traces/${id} returned ${response.status}`);
  return parseTraceText(await response.text());
}
