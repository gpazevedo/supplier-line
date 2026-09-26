import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { runChecks, type Failure } from './checks/index.js';
import { parseTrace } from './schema.js';

/** Outcome of checking a set of trace directories. */
export interface CheckResult {
  ok: boolean;
  report: string;
}

function checkFile(path: string): Failure[] {
  try {
    return runChecks(parseTrace(JSON.parse(readFileSync(path, 'utf8'))));
  } catch (error) {
    return [{ check: 'schema', where: 'file', message: String(error) }];
  }
}

const formatFailure = (f: Failure) => `  ${f.check} (${f.where}): ${f.message}`;

/** Runs the five acceptance checks on every `.json` trace in the given directories. */
export function checkTraces(dirs: string[]): CheckResult {
  const files = dirs.filter(existsSync).flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => join(dir, name))
  );
  const lines: string[] = [];
  let failed = 0;
  for (const file of files) {
    const failures = checkFile(file);
    if (failures.length === 0) continue;
    failed += 1;
    lines.push(`FAIL ${basename(file)}`, ...failures.map(formatFailure));
  }
  lines.push(`${files.length} traces, ${failed} failed`);
  return { ok: failed === 0, report: lines.join('\n') };
}
