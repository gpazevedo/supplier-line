import { App, Stack, Validations } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AwsSolutionsChecks } from 'cdk-nag';
import { beforeAll, describe, expect, it } from 'vitest';
import { ReaperConstruct } from './reaper-construct';

let template: Template;

beforeAll(() => {
  const stack = new Stack(new App(), 'Persistent', {
    env: { account: '111122223333', region: 'us-east-1' },
  });
  new ReaperConstruct(stack, 'Reaper', { alertEmail: 'owner@example.com' });
  template = Template.fromStack(stack);
});

describe('ReaperConstruct schedule', () => {
  it('invokes the reaper Lambda every 10 minutes', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(10 minutes)',
      State: 'ENABLED',
      Targets: [
        Match.objectLike({
          Arn: { 'Fn::GetAtt': [Match.stringLikeRegexp('^ReaperFunction'), 'Arn'] },
        }),
      ],
    });
  });
});

describe('ReaperConstruct alerts', () => {
  it('emails the owner through an SNS topic the Lambda knows', () => {
    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: 'owner@example.com',
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { TOPIC_ARN: { Ref: Match.stringLikeRegexp('^ReaperAlerts') } } },
    });
  });

  it('sends CloudFormation create and delete status changes to the Lambda', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        source: ['aws.cloudformation'],
        'detail-type': ['CloudFormation Stack Status Change'],
        detail: {
          'status-details': { status: ['CREATE_COMPLETE', 'DELETE_COMPLETE', 'DELETE_FAILED'] },
        },
      },
      Targets: [
        Match.objectLike({
          Arn: { 'Fn::GetAtt': [Match.stringLikeRegexp('^ReaperFunction'), 'Arn'] },
        }),
      ],
    });
  });
});

describe('ReaperConstruct error alarm', () => {
  it('alarms to the alerts topic on any reaper Lambda error', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/Lambda',
      MetricName: 'Errors',
      Dimensions: [
        { Name: 'FunctionName', Value: { Ref: Match.stringLikeRegexp('^ReaperFunction') } },
      ],
      Statistic: 'Sum',
      Period: 600,
      EvaluationPeriods: 1,
      Threshold: 1,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      TreatMissingData: 'notBreaching',
      AlarmActions: [{ Ref: Match.stringLikeRegexp('^ReaperAlerts') }],
    });
  });
});

function arnIn(service: string, resource: string) {
  return {
    'Fn::Join': [
      '',
      ['arn:', { Ref: 'AWS::Partition' }, `:${service}:us-east-1:111122223333:${resource}`],
    ],
  };
}

describe('ReaperConstruct IAM policy', () => {
  const ephemeralOnly = { StringEquals: { 'aws:ResourceTag/supplier-line:ephemeral': 'true' } };

  it('uses a role with no managed policies', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: [Match.objectLike({ Principal: { Service: 'lambda.amazonaws.com' } })],
      }),
      ManagedPolicyArns: Match.absent(),
    });
  });

  it('grants only its logs, listing, tag-scoped delete and scale, and publishing alerts', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      Roles: [{ Ref: Match.stringLikeRegexp('^ReaperRole') }],
      PolicyDocument: {
        Statement: [
          {
            Effect: 'Allow',
            Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
            Resource: { 'Fn::GetAtt': [Match.stringLikeRegexp('^ReaperLogs'), 'Arn'] },
          },
          { Effect: 'Allow', Action: 'cloudformation:DescribeStacks', Resource: '*' },
          {
            Effect: 'Allow',
            Action: ['cloudformation:DeleteStack', 'cloudformation:ListStackResources'],
            Resource: arnIn('cloudformation', 'stack/*'),
            Condition: ephemeralOnly,
          },
          {
            Effect: 'Allow',
            Action: 'ecs:UpdateService',
            Resource: arnIn('ecs', 'service/*'),
            Condition: ephemeralOnly,
          },
          {
            Effect: 'Allow',
            Action: 'sns:Publish',
            Resource: { Ref: Match.stringLikeRegexp('^ReaperAlerts') },
          },
        ],
      },
    });
  });
});

describe('ReaperConstruct cdk-nag', () => {
  it('passes AwsSolutions checks', () => {
    const app = new App();
    new ReaperConstruct(new Stack(app, 'Nag'), 'Reaper', { alertEmail: 'owner@example.com' });
    Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));
    expect(() => app.synth()).not.toThrow();
  });
});
