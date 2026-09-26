import { App } from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { ACCESS_CODE_PARAMETER, ACCESS_CODE_PLACEHOLDER, ECR_REPOSITORY } from '../config';
import { ERROR_MESSAGE } from './contact-flow';
import { PersistentStack } from './persistent-stack';

let template: Template;

const build = (alertEmail: string | undefined) =>
  new PersistentStack(new App(), 'Persistent', { alertEmail });

beforeAll(() => {
  template = Template.fromStack(build('owner@example.com'));
});

/** The logical ID of the only resource of `type` whose ID starts with `prefix`. */
function logicalId(type: string, prefix = ''): string {
  const ids = Object.keys(template.findResources(type)).filter((id) => id.startsWith(prefix));
  expect(ids).toHaveLength(1);
  return ids[0];
}

/** The contact flow content, with the bot alias ARN token replaced by a marker. */
function flowContent() {
  const [flow] = Object.values(template.findResources('AWS::Connect::ContactFlow'));
  const parts: unknown[] = flow.Properties.Content['Fn::Join'][1];
  const json = parts.map((p) => (typeof p === 'string' ? p : 'ALIAS_ARN')).join('');
  return { raw: parts, content: JSON.parse(json) };
}

describe('PersistentStack alert email', () => {
  it('errors on the stack when alertEmail is missing', () => {
    const errors = Annotations.fromStack(build(undefined)).findError(
      '*',
      Match.stringLikeRegexp('alertEmail')
    );
    expect(errors).toHaveLength(1);
  });
});

describe('PersistentStack storage', () => {
  it('creates the host ECR repository', () => {
    template.hasResourceProperties('AWS::ECR::Repository', { RepositoryName: ECR_REPOSITORY });
  });

  it('creates the traces bucket: named by account, encrypted, private, TLS only', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: { 'Fn::Join': ['', ['supplier-line-traces-', { Ref: 'AWS::AccountId' }]] },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      },
    });
  });

  it('creates the access-code parameter with the placeholder value only', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: ACCESS_CODE_PARAMETER,
      Value: ACCESS_CODE_PLACEHOLDER,
    });
  });
});

describe('PersistentStack Lex bot', () => {
  it('has an en_US PoStatus intent with a required PoDigits slot and a fulfillment hook', () => {
    template.hasResourceProperties('AWS::Lex::Bot', {
      BotLocales: [
        Match.objectLike({
          LocaleId: 'en_US',
          Intents: Match.arrayWith([
            Match.objectLike({
              Name: 'PoStatus',
              FulfillmentCodeHook: { Enabled: true },
              Slots: [
                Match.objectLike({
                  Name: 'PoDigits',
                  ValueElicitationSetting: Match.objectLike({ SlotConstraint: 'Required' }),
                }),
              ],
            }),
          ]),
        }),
      ],
    });
  });

  it('fulfils the intent with the PO status Lambda through the bot alias', () => {
    const lambda = logicalId('AWS::Lambda::Function', 'PoStatus');
    template.hasResourceProperties('AWS::Lex::BotAlias', {
      BotAliasLocaleSettings: [
        {
          LocaleId: 'en_US',
          BotAliasLocaleSetting: {
            Enabled: true,
            CodeHookSpecification: {
              LambdaCodeHook: {
                LambdaArn: { 'Fn::GetAtt': [lambda, 'Arn'] },
                CodeHookInterfaceVersion: '1.0',
              },
            },
          },
        },
      ],
    });
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      FunctionName: { 'Fn::GetAtt': [lambda, 'Arn'] },
      Principal: 'lexv2.amazonaws.com',
      SourceArn: { 'Fn::GetAtt': [logicalId('AWS::Lex::BotAlias'), 'Arn'] },
    });
  });
});

describe('PersistentStack Connect', () => {
  it('associates the bot alias with the Connect instance', () => {
    template.hasResourceProperties('AWS::Connect::IntegrationAssociation', {
      InstanceId: { 'Fn::GetAtt': [logicalId('AWS::Connect::Instance'), 'Arn'] },
      IntegrationType: 'LEX_BOT',
      IntegrationArn: { 'Fn::GetAtt': [logicalId('AWS::Lex::BotAlias'), 'Arn'] },
    });
  });

  it('hands callers to the bot alias in the contact flow', () => {
    const { raw, content } = flowContent();
    expect(raw).toContainEqual({ 'Fn::GetAtt': [logicalId('AWS::Lex::BotAlias'), 'Arn'] });
    const bot = content.Actions.find(
      (a: { Type: string }) => a.Type === 'ConnectParticipantWithLexBot'
    );
    expect(bot.Parameters.LexV2Bot.AliasArn).toBe('ALIAS_ARN');
  });

  it('routes bot errors to an error branch that plays the error message', () => {
    const { content } = flowContent();
    const byId = new Map(content.Actions.map((a: { Identifier: string }) => [a.Identifier, a]));
    const bot = content.Actions.find(
      (a: { Type: string }) => a.Type === 'ConnectParticipantWithLexBot'
    );
    const onError = bot.Transitions.Errors.find(
      (e: { ErrorType: string }) => e.ErrorType === 'NoMatchingError'
    );
    const branch = byId.get(onError.NextAction) as {
      Type: string;
      Parameters: { Text: string };
      Transitions: { NextAction: string };
    };
    expect(branch.Type).toBe('MessageParticipant');
    expect(branch.Parameters.Text).toBe(ERROR_MESSAGE);
    expect(byId.get(branch.Transitions.NextAction)).toMatchObject({
      Type: 'DisconnectParticipant',
    });
  });
});

describe('PersistentStack budgets', () => {
  it('emails the alert address at $10 and $30 of actual monthly spend', () => {
    const notification = (threshold: number) => ({
      Notification: {
        NotificationType: 'ACTUAL',
        ComparisonOperator: 'GREATER_THAN',
        Threshold: threshold,
        ThresholdType: 'ABSOLUTE_VALUE',
      },
      Subscribers: [{ SubscriptionType: 'EMAIL', Address: 'owner@example.com' }],
    });
    template.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: Match.objectLike({ BudgetType: 'COST', TimeUnit: 'MONTHLY' }),
      NotificationsWithSubscribers: [notification(10), notification(30)],
    });
  });
});

describe('PersistentStack reaper and outputs', () => {
  it('includes the reaper and its email alert', () => {
    template.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'rate(10 minutes)' });
    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: 'owner@example.com',
    });
  });

  it('outputs the three GitHub role ARNs', () => {
    for (const name of ['DemoRoleArn', 'TeardownRoleArn', 'InfraRoleArn']) {
      template.hasOutput(name, { Value: { 'Fn::GetAtt': [Match.anyValue(), 'Arn'] } });
    }
  });
});
