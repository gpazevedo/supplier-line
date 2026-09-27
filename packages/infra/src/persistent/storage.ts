import { Aws, Duration, Fn, Validations } from 'aws-cdk-lib';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import {
  ACCESS_CODE_PARAMETER,
  ACCESS_CODE_PLACEHOLDER,
  CONNECT_CONTACT_FLOW_ID_PARAMETER,
  CONNECT_INSTANCE_ID_PARAMETER,
  ECR_REPOSITORY,
} from '../config';

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

/**
 * The Connect instance and contact flow IDs the host needs for `StartWebRTCContact` (S17), read
 * by the app stack's Fargate task at deploy time (not a synth-time lookup) since the two stacks
 * deploy independently. `contactFlowArn` is `CfnContactFlow.attrContactFlowArn`, which exposes no
 * plain ID attribute; the ID is the segment after `contact-flow/`.
 */
export function createConnectIdParameters(
  scope: Construct,
  instanceId: string,
  contactFlowArn: string
): void {
  new StringParameter(scope, 'ConnectInstanceIdParam', {
    parameterName: CONNECT_INSTANCE_ID_PARAMETER,
    stringValue: instanceId,
    description: 'Amazon Connect instance ID for POST /api/connect/start (S17).',
  });
  new StringParameter(scope, 'ConnectContactFlowIdParam', {
    parameterName: CONNECT_CONTACT_FLOW_ID_PARAMETER,
    stringValue: Fn.select(1, Fn.split('/contact-flow/', contactFlowArn)),
    description: 'Amazon Connect contact flow ID for POST /api/connect/start (S17).',
  });
}
