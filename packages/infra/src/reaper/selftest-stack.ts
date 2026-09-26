import { CfnWaitConditionHandle, Stack, type StackProps, Tags } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { requireExpiresAt } from '../expiry';
import { EPHEMERAL_TAG } from './rules';

export const SELFTEST_STACK_NAME = 'supplier-line-reaper-selftest';

/** Five minutes after `now`, as ISO 8601 UTC to the second. */
export function selftestExpiresAt(now: Date): string {
  return new Date(now.getTime() + 5 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** A free, tagged stack for `pnpm reaper:selftest`: the reaper must email created, then delete it. */
export class SelftestStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & { expiresAt: string }) {
    super(scope, id, props);
    Tags.of(this).add('ExpiresAt', requireExpiresAt(props.expiresAt));
    Tags.of(this).add(EPHEMERAL_TAG, 'true');
    new CfnWaitConditionHandle(this, 'Placeholder');
  }
}
