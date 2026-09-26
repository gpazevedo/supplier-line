import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { serializeTrace, traceKey, type TraceWriter } from './writer.js';

/** The traces bucket for an AWS account: `supplier-line-traces-<account-id>`. */
export const tracesBucket = (accountId: string) => `supplier-line-traces-${accountId}`;

/** Puts each trace as a JSON object in `bucket`, using the caller's S3 client. */
export function s3TraceWriter(client: S3Client, bucket: string): TraceWriter {
  return {
    async write(trace) {
      const Key = traceKey(trace);
      const Body = serializeTrace(trace);
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key, Body, ContentType: 'application/json' })
      );
      return `s3://${bucket}/${Key}`;
    },
  };
}
