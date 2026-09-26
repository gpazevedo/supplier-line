import { Fn, Stack, type StackProps, Tags, Validations } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { requireExpiresAt } from './expiry';
import { createHostService } from './host-service';
import { createLoadBalancer } from './load-balancer';
import { createVpc } from './network';
import { createSite } from './site';

export interface AppStackProps extends StackProps {
  /** ISO 8601 UTC expiry; the reaper deletes the stack after it. Required. */
  expiresAt: string | undefined;
  /** Tag of the host image in the ECR repository. */
  imageTag: string;
}

/** Ephemeral app stack: VPC, Fargate host, ALB and CloudFront. Exists only during approved windows. */
export class AppStack extends Stack {
  /** `Fn::GetAZs`, resolved by CloudFormation at deploy time, instead of a synth-time context lookup. */
  override get availabilityZones(): string[] {
    return [Fn.select(0, Fn.getAzs()), Fn.select(1, Fn.getAzs())];
  }

  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);
    Tags.of(this).add('ExpiresAt', requireExpiresAt(props.expiresAt));
    Tags.of(this).add('supplier-line:ephemeral', 'true');
    const vpc = createVpc(this);
    const lb = createLoadBalancer(this, vpc);
    createHostService(this, vpc, lb, props.imageTag);
    createSite(this, lb);
    Validations.of(this).acknowledge({
      id: 'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]',
      reason:
        "The CDK-provided singleton Lambda behind the prefix-list lookup uses AWS's basic execution role.",
    });
  }
}
