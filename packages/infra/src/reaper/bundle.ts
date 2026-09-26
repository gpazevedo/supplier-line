import { dirname, join } from 'node:path';
import { AssetHashType, DockerImage } from 'aws-cdk-lib';
import { Code } from 'aws-cdk-lib/aws-lambda';
import { buildSync } from 'esbuild';

/**
 * Bundles a TypeScript Lambda entry with esbuild at synth time, in-process, into `index.mjs`.
 * The AWS SDK is left out: the Node.js Lambda runtime provides it.
 */
export function bundledCode(entry: string): Code {
  return Code.fromAsset(dirname(entry), {
    assetHashType: AssetHashType.OUTPUT,
    bundling: {
      image: DockerImage.fromRegistry('unused-local-bundling-only'),
      local: {
        tryBundle(outputDir) {
          buildSync({
            entryPoints: [entry],
            bundle: true,
            platform: 'node',
            target: 'node24',
            format: 'esm',
            external: ['@aws-sdk/*'],
            outfile: join(outputDir, 'index.mjs'),
            logLevel: 'error',
          });
          return true;
        },
      },
    },
  });
}
