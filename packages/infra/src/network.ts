import { Validations } from 'aws-cdk-lib';
import { SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import type { Construct } from 'constructs';

/** Two public subnets, no NAT gateway: the Fargate task gets a public IP instead. */
export function createVpc(scope: Construct): Vpc {
  const vpc = new Vpc(scope, 'Vpc', {
    maxAzs: 2,
    natGateways: 0,
    subnetConfiguration: [{ name: 'public', subnetType: SubnetType.PUBLIC }],
  });
  Validations.of(vpc).acknowledge({
    id: 'AwsSolutions-VPC7',
    reason: 'Short-lived demo VPC with one task; flow logs would outlive it and add cost.',
  });
  return vpc;
}
