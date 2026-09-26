import { fileURLToPath } from 'node:url';
import { Duration, Stack, Validations } from 'aws-cdk-lib';
import { ComparisonOperator, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Architecture, Function as LambdaFn, Runtime } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import { bundledCode } from './bundle';
import { ALERTED_STATUSES, EPHEMERAL_TAG } from './rules';

export interface ReaperConstructProps {
  /** Address that receives the alert emails; the owner confirms the SNS subscription once. */
  alertEmail: string;
}

const TAG_SCOPED_ARNS = [
  'cloudformation:<AWS::Region>:<AWS::AccountId>:stack/*',
  'ecs:<AWS::Region>:<AWS::AccountId>:service/*',
];

/**
 * Reaper Lambda, run every 10 minutes, that deletes app stacks whose window is over,
 * plus email alerts on stack created, deleted, delete failed, and reaper errors.
 * S10 places it in the persistent stack.
 */
export class ReaperConstruct extends Construct {
  readonly function: LambdaFn;
  readonly alerts: Topic;
  private readonly role: Role;

  constructor(scope: Construct, id: string, props: ReaperConstructProps) {
    super(scope, id);
    this.alerts = new Topic(this, 'Alerts', { enforceSSL: true });
    this.alerts.addSubscription(new EmailSubscription(props.alertEmail));
    this.role = new Role(this, 'Role', { assumedBy: new ServicePrincipal('lambda.amazonaws.com') });
    this.function = this.createFunction();
    this.grantReaping();
    this.alerts.grantPublish(this.function);
    this.addTriggers();
    this.addErrorAlarm();
  }

  /** The role has no managed policies: for logs it may write only to this log group. */
  private createFunction(): LambdaFn {
    const logGroup = new LogGroup(this, 'Logs', { retention: RetentionDays.ONE_MONTH });
    logGroup.grantWrite(this.role);
    return new LambdaFn(this, 'Function', {
      code: bundledCode(fileURLToPath(new URL('./handler.ts', import.meta.url))),
      handler: 'index.handler',
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(2),
      role: this.role,
      logGroup,
      environment: { TOPIC_ARN: this.alerts.topicArn },
    });
  }

  /** Listing needs `*`; deleting stacks and scaling services is limited to resources tagged ephemeral. */
  private grantReaping() {
    const stack = Stack.of(this);
    const ephemeralOnly = { StringEquals: { [`aws:ResourceTag/${EPHEMERAL_TAG}`]: 'true' } };
    this.role.addToPolicy(
      new PolicyStatement({ actions: ['cloudformation:DescribeStacks'], resources: ['*'] })
    );
    this.role.addToPolicy(
      new PolicyStatement({
        actions: ['cloudformation:DeleteStack', 'cloudformation:ListStackResources'],
        resources: [
          stack.formatArn({ service: 'cloudformation', resource: 'stack', resourceName: '*' }),
        ],
        conditions: ephemeralOnly,
      })
    );
    this.role.addToPolicy(
      new PolicyStatement({
        actions: ['ecs:UpdateService'],
        resources: [stack.formatArn({ service: 'ecs', resource: 'service', resourceName: '*' })],
        conditions: ephemeralOnly,
      })
    );
    this.acknowledgeWildcards();
  }

  private acknowledgeWildcards() {
    const validations = Validations.of(this.role);
    validations.acknowledge({
      id: 'AwsSolutions-IAM5[Resource::*]',
      reason: 'cloudformation:DescribeStacks must list all stacks to find tagged ones.',
    });
    for (const arn of TAG_SCOPED_ARNS) {
      validations.acknowledge({
        id: `AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:${arn}]`,
        reason: `Names are not known in advance; aws:ResourceTag limits it to ${EPHEMERAL_TAG}=true.`,
      });
    }
  }

  private addTriggers() {
    const target = new LambdaFunction(this.function);
    new Rule(this, 'Schedule', {
      schedule: Schedule.rate(Duration.minutes(10)),
      targets: [target],
    });
    new Rule(this, 'StackStatus', {
      eventPattern: {
        source: ['aws.cloudformation'],
        detailType: ['CloudFormation Stack Status Change'],
        detail: { 'status-details': { status: Object.keys(ALERTED_STATUSES) } },
      },
      targets: [target],
    });
  }

  private addErrorAlarm() {
    const alarm = this.function
      .metricErrors({ period: Duration.minutes(10), statistic: 'Sum' })
      .createAlarm(this, 'ErrorAlarm', {
        alarmDescription:
          'The supplier-line reaper Lambda failed; stacks may outlive their window.',
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      });
    alarm.addAlarmAction(new SnsAction(this.alerts));
  }
}
