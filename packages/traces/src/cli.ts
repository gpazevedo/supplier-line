import { fileURLToPath } from 'node:url';
import { checkTraces } from './check-traces.js';

const dirs = ['../samples/', '../../../fixtures/traces/'].map((path) =>
  fileURLToPath(new URL(path, import.meta.url))
);

const { ok, report } = checkTraces(dirs);
console.log(report);
process.exit(ok ? 0 : 1);
