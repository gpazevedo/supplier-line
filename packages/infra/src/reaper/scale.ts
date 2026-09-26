import {
  type CloudFormationClient,
  paginateListStackResources,
} from '@aws-sdk/client-cloudformation';
import { ECSClient, UpdateServiceCommand } from '@aws-sdk/client-ecs';

const ecs = new ECSClient({});

async function serviceArns(cfn: CloudFormationClient, stackId: string): Promise<string[]> {
  const arns: string[] = [];
  for await (const page of paginateListStackResources({ client: cfn }, { StackName: stackId })) {
    for (const r of page.StackResourceSummaries ?? []) {
      const live = !r.ResourceStatus?.startsWith('DELETE');
      if (r.ResourceType === 'AWS::ECS::Service' && live && r.PhysicalResourceId) {
        arns.push(r.PhysicalResourceId);
      }
    }
  }
  return arns;
}

/** Sets desiredCount 0 on every live ECS service in the stack, so Fargate billing stops before deletion. */
export async function scaleServicesToZero(cfn: CloudFormationClient, stackId: string) {
  for (const service of await serviceArns(cfn, stackId)) {
    const cluster = service.split('/')[1];
    await ecs.send(new UpdateServiceCommand({ cluster, service, desiredCount: 0 }));
  }
}
