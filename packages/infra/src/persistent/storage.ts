import { Aws, Duration, Validations } from 'aws-cdk-lib';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { ACCESS_CODE_PARAMETER, ACCESS_CODE_PLACEHOLDER, ECR_REPOSITORY } from '../config';

/** ECR repository for the host image; keeps the 10 newest images to bound storage cost. */
export function createRepository(scope: Construct): Repository {
  return new Repository(scope, 'HostRepository', {
    repositoryName: ECR_REPOSITORY,
    imageScanOnPush: true,
    lifecycleRules: [{ maxImageCount: 10 }],
  });
}

/** Private, encrypted, TLS-only bucket `supplier-line-traces-<account-id>` for session traces. */
export function createTracesBucket(scope: Construct): Bucket {
  const bucket = new Bucket(scope, 'TracesBucket', {
    bucketName: `supplier-line-traces-${Aws.ACCOUNT_ID}`,
    encryption: BucketEncryption.S3_MANAGED,
    blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    enforceSSL: true,
    lifecycleRules: [{ expiration: Duration.days(90) }],
  });
  Validations.of(bucket).acknowledge({
    id: 'AwsSolutions-S1',
    reason:
      'Demo traces only; access logs would need a second bucket and the host already records each session.',
  });
  return bucket;
}

/** The demo access code parameter. Created with a placeholder; the owner sets the real value by hand. */
export function createAccessCodeParameter(scope: Construct): StringParameter {
  return new StringParameter(scope, 'AccessCode', {
    parameterName: ACCESS_CODE_PARAMETER,
    stringValue: ACCESS_CODE_PLACEHOLDER,
    description:
      'Demo access code checked on WebSocket connect. Placeholder until the owner sets it.',
  });
}
