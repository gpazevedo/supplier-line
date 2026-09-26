import {
  CloudFormationClient,
  DeleteStackCommand,
  DescribeStacksCommand,
  ListStackResourcesCommand,
  type Stack,
} from '@aws-sdk/client-cloudformation';
import { ECSClient, UpdateServiceCommand } from '@aws-sdk/client-ecs';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handler, type ReaperEvent } from './handler';

const NOW = new Date('2026-09-26T12:00:00Z');
const STACK_ID = 'arn:aws:cloudformation:us-east-1:111122223333:stack/supplier-line-app/abc';
const SCHEDULED: ReaperEvent = { source: 'aws.events', detail: {} };

const SERVICE_ARN = 'arn:aws:ecs:us-east-1:111122223333:service/app-cluster/host';
const EXPIRED = { 'supplier-line:ephemeral': 'true', ExpiresAt: '2026-09-26T11:59:00Z' };

const cfn = mockClient(CloudFormationClient);
const ecs = mockClient(ECSClient);
const sns = mockClient(SNSClient);
const TOPIC_ARN = 'arn:aws:sns:us-east-1:111122223333:alerts';

function alerts() {
  return sns.commandCalls(PublishCommand).map((c) => c.args[0].input);
}

function appStack(tags: Record<string, string>, created = '2026-09-26T11:00:00Z'): Stack {
  return {
    StackId: STACK_ID,
    StackName: 'supplier-line-app',
    StackStatus: 'CREATE_COMPLETE',
    CreationTime: new Date(created),
    Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
  };
}

function givenStacks(...stacks: Stack[]) {
  cfn.on(DescribeStacksCommand).resolves({ Stacks: stacks });
  cfn.on(ListStackResourcesCommand).resolves({ StackResourceSummaries: [] });
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  process.env.TOPIC_ARN = TOPIC_ARN;
});

afterEach(() => {
  cfn.reset();
  ecs.reset();
  sns.reset();
  vi.useRealTimers();
});

describe('reaper schedule', () => {
  it('deletes a tagged stack whose ExpiresAt is past', async () => {
    givenStacks(appStack({ 'supplier-line:ephemeral': 'true', ExpiresAt: '2026-09-26T11:59:00Z' }));
    await handler(SCHEDULED);
    expect(cfn.commandCalls(DeleteStackCommand)[0]?.args[0].input).toEqual({
      StackName: STACK_ID,
    });
  });

  it.each([
    ['ExpiresAt is missing', {}],
    ['ExpiresAt is malformed', { ExpiresAt: 'tomorrow' }],
    ['ExpiresAt is not UTC ISO 8601', { ExpiresAt: '2026-09-26T13:00:00' }],
  ])('deletes a tagged stack when %s', async (_, tags) => {
    givenStacks(appStack({ 'supplier-line:ephemeral': 'true', ...tags }));
    await handler(SCHEDULED);
    expect(cfn.commandCalls(DeleteStackCommand)).toHaveLength(1);
  });

  it('deletes a tagged stack older than 8 hours even if ExpiresAt is later', async () => {
    givenStacks(
      appStack(
        { 'supplier-line:ephemeral': 'true', ExpiresAt: '2026-09-27T00:00:00Z' },
        '2026-09-26T03:59:00Z'
      )
    );
    await handler(SCHEDULED);
    expect(cfn.commandCalls(DeleteStackCommand)).toHaveLength(1);
  });

  it('keeps a tagged stack that is not yet expired and younger than 8 hours', async () => {
    givenStacks(
      appStack(
        { 'supplier-line:ephemeral': 'true', ExpiresAt: '2026-09-26T12:30:00Z' },
        '2026-09-26T04:01:00Z'
      )
    );
    await handler(SCHEDULED);
    expect(cfn.commandCalls(DeleteStackCommand)).toHaveLength(0);
  });

  it('ignores stacks without the ephemeral tag', async () => {
    givenStacks(appStack({ ExpiresAt: '2026-09-26T11:00:00Z' }));
    await handler(SCHEDULED);
    expect(cfn.commandCalls(DeleteStackCommand)).toHaveLength(0);
  });

  it('leaves a stack that is already being deleted', async () => {
    givenStacks({
      ...appStack({ 'supplier-line:ephemeral': 'true' }),
      StackStatus: 'DELETE_IN_PROGRESS',
    });
    await handler(SCHEDULED);
    expect(cfn.commandCalls(DeleteStackCommand)).toHaveLength(0);
  });
});

describe('reaper scale-to-zero', () => {
  it('scales the stack ECS services to zero before deleting it', async () => {
    givenStacks(appStack(EXPIRED));
    cfn.on(ListStackResourcesCommand).resolves({
      StackResourceSummaries: [
        {
          LogicalResourceId: 'HostService',
          ResourceType: 'AWS::ECS::Service',
          PhysicalResourceId: SERVICE_ARN,
          ResourceStatus: 'CREATE_COMPLETE',
          LastUpdatedTimestamp: NOW,
        },
        {
          LogicalResourceId: 'Old',
          ResourceType: 'AWS::ECS::Service',
          PhysicalResourceId: `${SERVICE_ARN}-old`,
          ResourceStatus: 'DELETE_COMPLETE',
          LastUpdatedTimestamp: NOW,
        },
      ],
    });
    const order: string[] = [];
    ecs.on(UpdateServiceCommand).callsFake(() => order.push('scale'));
    cfn.on(DeleteStackCommand).callsFake(() => order.push('delete'));

    await handler(SCHEDULED);

    expect(ecs.commandCalls(UpdateServiceCommand).map((c) => c.args[0].input)).toEqual([
      { cluster: 'app-cluster', service: SERVICE_ARN, desiredCount: 0 },
    ]);
    expect(order).toEqual(['scale', 'delete']);
  });
});

describe('reaper alerts', () => {
  it('emails the reason when the reaper starts a deletion', async () => {
    givenStacks(appStack(EXPIRED));
    await handler(SCHEDULED);
    expect(alerts()).toEqual([
      {
        TopicArn: TOPIC_ARN,
        Subject: 'supplier-line: reaper deleting supplier-line-app',
        Message: expect.stringContaining('ExpiresAt 2026-09-26T11:59:00Z is past'),
      },
    ]);
  });

  it('sends no email when nothing is due', async () => {
    givenStacks(appStack({ 'supplier-line:ephemeral': 'true', ExpiresAt: '2026-09-26T13:00:00Z' }));
    await handler(SCHEDULED);
    expect(alerts()).toEqual([]);
  });
});

function statusChange(status: string): ReaperEvent {
  return {
    source: 'aws.cloudformation',
    detail: { 'stack-id': STACK_ID, 'status-details': { status, 'status-reason': 'why' } },
  };
}

describe('stack status alerts', () => {
  it.each([
    ['CREATE_COMPLETE', 'supplier-line-app created'],
    ['DELETE_COMPLETE', 'supplier-line-app deleted'],
    ['DELETE_FAILED', 'supplier-line-app delete failed'],
  ])('emails on %s of an ephemeral stack', async (status, subject) => {
    cfn
      .on(DescribeStacksCommand, { StackName: STACK_ID })
      .resolves({ Stacks: [appStack({ 'supplier-line:ephemeral': 'true', ExpiresAt: 'x' })] });
    await handler(statusChange(status));
    expect(alerts()).toEqual([
      {
        TopicArn: TOPIC_ARN,
        Subject: `supplier-line: ${subject}`,
        Message: expect.stringContaining(STACK_ID),
      },
    ]);
  });

  it('ignores status changes of other stacks', async () => {
    cfn.on(DescribeStacksCommand).resolves({ Stacks: [appStack({})] });
    await handler(statusChange('CREATE_COMPLETE'));
    expect(alerts()).toEqual([]);
  });

  it('does not reap on a status change event', async () => {
    cfn.on(DescribeStacksCommand).resolves({ Stacks: [appStack(EXPIRED)] });
    await handler(statusChange('CREATE_COMPLETE'));
    expect(cfn.commandCalls(DeleteStackCommand)).toHaveLength(0);
  });
});

describe('reaper error path', () => {
  it('reaps the other stacks, emails the failure, and rejects so the error alarm fires', async () => {
    const other = { ...appStack(EXPIRED), StackId: `${STACK_ID}-2`, StackName: 'selftest' };
    givenStacks(appStack(EXPIRED), other);
    cfn
      .on(DeleteStackCommand, { StackName: STACK_ID })
      .rejects(new Error('AccessDenied'))
      .on(DeleteStackCommand, { StackName: other.StackId })
      .resolves({});

    await expect(handler(SCHEDULED)).rejects.toThrow(/AccessDenied/);

    expect(cfn.commandCalls(DeleteStackCommand)).toHaveLength(2);
    expect(alerts()).toContainEqual({
      TopicArn: TOPIC_ARN,
      Subject: 'supplier-line: reaper failed to delete supplier-line-app',
      Message: expect.stringContaining('AccessDenied'),
    });
  });

  it('rejects when stacks cannot be listed', async () => {
    cfn.on(DescribeStacksCommand).rejects(new Error('Throttling'));
    await expect(handler(SCHEDULED)).rejects.toThrow(/Throttling/);
  });
});
