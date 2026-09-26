import {
  CloudFormationClient,
  DeleteStackCommand,
  paginateDescribeStacks,
  type Stack,
} from '@aws-sdk/client-cloudformation';
import { alert } from './alert';
import { deletionReason, isEphemeral } from './rules';
import { scaleServicesToZero } from './scale';
import { alertOnStatus, type StackStatusDetail } from './status';

const cfn = new CloudFormationClient({});

async function ephemeralStacks(): Promise<Stack[]> {
  const stacks: Stack[] = [];
  for await (const page of paginateDescribeStacks({ client: cfn }, {})) {
    stacks.push(...(page.Stacks ?? []).filter(isEphemeral));
  }
  return stacks;
}

async function reap(stack: Stack): Promise<void> {
  const reason = deletionReason(stack, new Date());
  if (stack.StackStatus === 'DELETE_IN_PROGRESS' || !reason) return;
  const stackId = String(stack.StackId);
  await scaleServicesToZero(cfn, stackId);
  await cfn.send(new DeleteStackCommand({ StackName: stackId }));
  await alert(
    `reaper deleting ${stack.StackName}`,
    `Scaled ECS to zero and started deleting ${stackId}: ${reason}.`
  );
}

async function reapOrAlert(stack: Stack): Promise<void> {
  try {
    await reap(stack);
  } catch (error) {
    await alert(`reaper failed to delete ${stack.StackName}`, `${stack.StackId}: ${error}`);
    throw error;
  }
}

/** The EventBridge events the reaper receives: its schedule and CloudFormation status changes. */
export type ReaperEvent =
  | { source: 'aws.events'; detail: unknown }
  | { source: 'aws.cloudformation'; detail: StackStatusDetail };

/** Scheduled: deletes each ephemeral stack whose window is over. Status change: emails the owner. */
export async function handler(event: ReaperEvent): Promise<void> {
  if (event.source === 'aws.cloudformation') return alertOnStatus(cfn, event.detail);
  const stacks = await ephemeralStacks();
  const results = await Promise.allSettled(stacks.map(reapOrAlert));
  const failures = results.flatMap((r) => (r.status === 'rejected' ? [String(r.reason)] : []));
  if (failures.length) throw new Error(`reaper failed: ${failures.join('; ')}`);
}
