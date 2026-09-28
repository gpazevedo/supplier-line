import { fileURLToPath } from 'node:url';

/**
 * The `assets/` folder: `ASSETS_DIR` when set (the container image sets it, since the bundle's own
 * path no longer leads back to the repo), otherwise the repo's `assets/` next to this source file.
 */
export function assetsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.ASSETS_DIR ?? fileURLToPath(new URL('../../../../assets/', import.meta.url));
}
