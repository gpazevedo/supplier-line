import { type CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { alert } from './alert';
import { ALERTED_STATUSES, isEphemeral } from './rules';

/** The `detail` of an EventBridge `CloudFormation Stack Status Change` event. */
export interface StackStatusDetail {
  'stack-id': string;
  'status-details': { status: string; 'status-reason'?: string };
}

/** Emails when an ephemeral stack is created, deleted, or fails to delete. */
export async function alertOnStatus(cfn: CloudFormationClient, detail: StackStatusDetail) {
  const verb = ALERTED_STATUSES[detail['status-details'].status];
  if (!verb) return;
  const stackId = detail['stack-id'];
  const { Stacks } = await cfn.send(new DescribeStacksCommand({ StackName: stackId }));
  const stack = Stacks?.[0];
  if (!stack || !isEphemeral(stack)) return;
  const reason = detail['status-details']['status-reason'] ?? '';
  await alert(`${stack.StackName} ${verb}`, `${stackId} is ${verb}. ${reason}`.trim());
}
