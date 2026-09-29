import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Writes the player's pass/fail summary as `<outDir>/report.txt`. It is not JSON, so
 * `pnpm check:traces <outDir>` reads only the traces beside it. Returns the file's path.
 */
export async function writeReplayReport(
  outDir: string,
  results: { name: string; pass: boolean }[]
): Promise<string> {
  const path = join(outDir, 'report.txt');
  const lines = results.map((r) => `${r.pass ? 'PASS' : 'FAIL'} ${r.name}\n`);
  await writeFile(path, lines.join(''));
  return path;
}
