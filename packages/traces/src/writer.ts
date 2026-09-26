import { parseTrace, type Trace } from './schema.js';

/** A trace destination. `write` resolves to where the trace landed (file path or S3 URI). */
export interface TraceWriter {
  write(trace: Trace): Promise<string>;
}

/** The object name for a trace, the same on every target. */
export const traceKey = (trace: Trace) => `${trace.session_id}.json`;

/** Validates the trace, then renders it as JSON, so a broken trace is never written. */
export const serializeTrace = (trace: Trace) => JSON.stringify(parseTrace(trace), null, 2);
