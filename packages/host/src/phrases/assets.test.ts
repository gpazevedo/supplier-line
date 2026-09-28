import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { assetsDir } from './assets.js';

it('uses ASSETS_DIR when set, as in the container image', () => {
  expect(assetsDir({ ASSETS_DIR: '/app/assets' })).toBe('/app/assets');
});

it("falls back to the repo's assets folder", () => {
  expect(existsSync(join(assetsDir({}), 'phrases', 'manifest.json'))).toBe(true);
  expect(existsSync(join(assetsDir({}), 'notices', 'session-expired.wav'))).toBe(true);
});
