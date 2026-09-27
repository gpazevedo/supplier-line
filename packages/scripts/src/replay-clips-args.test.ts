import { describe, expect, it } from 'vitest';
import { parseReplayClipsArgs, resolveOutDir } from './replay-clips-args.js';

describe('parseReplayClipsArgs', () => {
  it('parses flags passed directly, as tsx sees them in dev', () => {
    expect(parseReplayClipsArgs(['--url', 'ws://x/ws', '--out', 'dir'])).toEqual({
      url: 'ws://x/ws',
      out: 'dir',
      longSeconds: 180,
    });
  });

  it('tolerates the leading -- that `pnpm run <script> -- <args>` forwards unstripped', () => {
    expect(
      parseReplayClipsArgs(['--', '--url', 'ws://x/ws', '--out', 'dir', '--long-seconds', '90'])
    ).toEqual({ url: 'ws://x/ws', out: 'dir', longSeconds: 90 });
  });

  it('applies defaults with no args', () => {
    expect(parseReplayClipsArgs([])).toEqual({
      url: 'ws://127.0.0.1:8080/ws',
      out: 'traces/live',
      longSeconds: 180,
    });
  });
});

describe('resolveOutDir', () => {
  it('resolves a relative --out against the repo root, not the process cwd', () => {
    expect(resolveOutDir('traces/live', '/repo')).toBe('/repo/traces/live');
  });

  it('keeps an absolute --out as-is', () => {
    expect(resolveOutDir('/abs/traces', '/repo')).toBe('/abs/traces');
  });
});
