import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { selftestExpiresAt, SelftestStack } from './selftest-stack';

describe('reaper self-test stack', () => {
  it('expires 5 minutes from now, to the second, in UTC', () => {
    expect(selftestExpiresAt(new Date('2026-09-26T12:00:30.500Z'))).toBe('2026-09-26T12:05:30Z');
  });

  it('is tagged for the reaper and holds a single free resource', () => {
    const stack = new SelftestStack(new App(), 'Selftest', { expiresAt: '2026-09-26T12:05:30Z' });
    const resources = Object.values(Template.fromStack(stack).toJSON().Resources);
    expect(stack.tags.tagValues()).toEqual({
      ExpiresAt: '2026-09-26T12:05:30Z',
      'supplier-line:ephemeral': 'true',
    });
    expect(resources).toEqual([{ Type: 'AWS::CloudFormation::WaitConditionHandle' }]);
  });
});
