import { fileURLToPath } from 'node:url';
import { S3Client } from '@aws-sdk/client-s3';
import { localTraceWriter, s3TraceWriter, type TraceWriter } from 'traces/src/index.js';

/**
 * Where session traces go: the S3 bucket named by `TRACES_BUCKET` when set (the Fargate task sets
 * it), otherwise `TRACE_DIR`, or the repo's `traces/` folder when running from source.
 */
export function traceWriter(env: NodeJS.ProcessEnv = process.env): TraceWriter {
  if (env.TRACES_BUCKET) {
    return s3TraceWriter(new S3Client({ region: 'us-east-1' }), env.TRACES_BUCKET);
  }
  return localTraceWriter(
    env.TRACE_DIR ?? fileURLToPath(new URL('../../../traces/', import.meta.url))
  );
}
