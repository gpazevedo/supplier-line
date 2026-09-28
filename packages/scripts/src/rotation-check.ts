import type { Trace } from 'traces/src/index.js';

/** Passes when the session crossed at least one FH-05 rotation, as the live smoke job requires. */
export function rotationCheck(trace: Trace | undefined): { pass: boolean; detail: string } {
  if (!trace) return { pass: false, detail: 'no trace returned' };
  const rotations = trace.events.filter((event) => event.fh.id === 'FH-05').length;
  return { pass: rotations > 0, detail: `${rotations} rotation${rotations === 1 ? '' : 's'}` };
}
