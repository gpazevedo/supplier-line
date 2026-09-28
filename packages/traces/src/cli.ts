import { fileURLToPath } from 'node:url';
import { checkTraces } from './check-traces.js';

/**
 * `pnpm check:traces [dir…]`: with no arguments, checks the committed samples and fixtures; given
 * directories (absolute, since pnpm runs this in `packages/traces`), checks only those and fails if
 * they hold no trace.
 */
const args = process.argv.slice(2);
const committed = ['../samples/', '../../../fixtures/traces/'].map((path) =>
  fileURLToPath(new URL(path, import.meta.url))
);

const { ok, report } = checkTraces(args.length ? args : committed, {
  requireTraces: args.length > 0,
});
console.log(report);
process.exit(ok ? 0 : 1);
