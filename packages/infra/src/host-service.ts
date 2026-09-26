import { Arn, Duration, RemovalPolicy, Stack, Validations } from 'aws-cdk-lib';
import { type IVpc, Port, SecurityGroup, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import {
  Cluster,
  ContainerImage,
  CpuArchitecture,
  FargateService,
  FargateTaskDefinition,
  LogDrivers,
  OperatingSystemFamily,
} from 'aws-cdk-lib/aws-ecs';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import { ECR_REPOSITORY, HEALTH_PATH, HOST_PORT, NOVA_SONIC_MODEL } from './config';
import type { LoadBalancer } from './load-balancer';

function createTaskDefinition(scope: Construct, imageTag: string): FargateTaskDefinition {
  const stack = Stack.of(scope);
  const task = new FargateTaskDefinition(scope, 'HostTask', {
    cpu: 512,
    memoryLimitMiB: 1024,
    runtimePlatform: {
      cpuArchitecture: CpuArchitecture.ARM64,
      operatingSystemFamily: OperatingSystemFamily.LINUX,
    },
  });
  task.addContainer('host', {
    image: ContainerImage.fromEcrRepository(
      Repository.fromRepositoryName(scope, 'HostRepo', ECR_REPOSITORY),
      imageTag
    ),
    portMappings: [{ containerPort: HOST_PORT }],
    logging: LogDrivers.awsLogs({
      streamPrefix: 'host',
      logGroup: new LogGroup(scope, 'HostLogs', {
        retention: RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    }),
  });
  task.addToTaskRolePolicy(
    new PolicyStatement({
      actions: ['bedrock:InvokeModelWithBidirectionalStream'],
      resources: [
        Arn.format(
          {
            service: 'bedrock',
            resource: 'foundation-model',
            resourceName: NOVA_SONIC_MODEL,
            account: '',
          },
          stack
        ),
      ],
    })
  );
  task.addToTaskRolePolicy(
    new PolicyStatement({
      actions: ['s3:PutObject'],
      resources: [`arn:${stack.partition}:s3:::supplier-line-traces-${stack.account}/*`],
    })
  );
  Validations.of(task.obtainExecutionRole()).acknowledge({
    id: 'AwsSolutions-IAM5[Resource::*]',
    reason: 'ecr:GetAuthorizationToken does not support resource-level permissions.',
  });
  Validations.of(task.taskRole).acknowledge({
    id: 'AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:s3:::supplier-line-traces-<AWS::AccountId>/*]',
    reason:
      'The host writes one trace object per session under keys it chooses; PutObject only, on the traces bucket only.',
  });
  return task;
}

/** One ARM64 Fargate task (0.5 vCPU, 1 GB) in a public subnet with a public IP, reachable only from the ALB. */
export function createHostService(
  scope: Construct,
  vpc: IVpc,
  lb: LoadBalancer,
  imageTag: string
): FargateService {
  const securityGroup = new SecurityGroup(scope, 'HostSecurityGroup', {
    vpc,
    description: 'Host task: from the load balancer only',
  });
  const cluster = new Cluster(scope, 'Cluster', { vpc });
  Validations.of(cluster).acknowledge({
    id: 'AwsSolutions-ECS4',
    reason:
      'Container Insights bills per metric; the host logs to CloudWatch and writes its own traces.',
  });
  const service = new FargateService(scope, 'HostService', {
    cluster: cluster,
    taskDefinition: createTaskDefinition(scope, imageTag),
    desiredCount: 1,
    minHealthyPercent: 100,
    circuitBreaker: { rollback: true },
    assignPublicIp: true,
    vpcSubnets: { subnetType: SubnetType.PUBLIC },
    securityGroups: [securityGroup],
  });
  lb.listener.addTargets('Host', {
    port: HOST_PORT,
    targets: [service],
    healthCheck: { path: HEALTH_PATH },
    deregistrationDelay: Duration.seconds(30),
  });
  securityGroup.connections.allowFrom(lb.alb, Port.tcp(HOST_PORT));
  return service;
}
