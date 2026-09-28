import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

export interface ReplayClipsArgs {
  url: string;
  out: string;
  longSeconds: number;
  /** Fail the long scenario unless its trace shows an FH-05 rotation. */
  requireRotation: boolean;
}

/**
 * Parses `replay-clips` CLI args. Tolerates a leading `--`: `pnpm run <script> -- <args>`
 * forwards that separator into argv unstripped (unlike `npm run`), so `node:util`'s `parseArgs`
 * would otherwise reject the first real flag as an unexpected positional.
 */
export function parseReplayClipsArgs(argv: string[]): ReplayClipsArgs {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const { values } = parseArgs({
    args,
    options: {
      url: { type: 'string', default: 'ws://127.0.0.1:8080/ws' },
      out: { type: 'string', default: 'traces/live' },
      'long-seconds': { type: 'string', default: '180' },
      'require-rotation': { type: 'boolean', default: false },
    },
  });
  return {
    url: values.url,
    out: values.out,
    longSeconds: Number(values['long-seconds']),
    requireRotation: values['require-rotation'],
  };
}

/**
 * Resolves `--out` against the repo root rather than the process's cwd: `pnpm --filter <pkg> run
 * <script>` runs with cwd set to that package's directory, not the repo root that `demo-up.yml`'s
 * later `upload-artifact` and `check:traces` steps expect the traces under.
 */
export function resolveOutDir(out: string, repoRoot: string): string {
  return resolve(repoRoot, out);
}
