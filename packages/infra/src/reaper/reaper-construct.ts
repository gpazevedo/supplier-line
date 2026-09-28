import { fileURLToPath } from 'node:url';
import { Aws, Duration, Validations } from 'aws-cdk-lib';
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
    this.addAlarms();
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

  /** Listing needs `*` (DescribeStacks with no name also needs ListStacks); deleting stacks and scaling services is limited to resources tagged ephemeral. */
  private grantReaping() {
    const ephemeralOnly = { StringEquals: { [`aws:ResourceTag/${EPHEMERAL_TAG}`]: 'true' } };
    this.role.addToPolicy(
      new PolicyStatement({
        actions: ['cloudformation:DescribeStacks', 'cloudformation:ListStacks'],
        resources: ['*'],
      })
    );
    this.role.addToPolicy(
      new PolicyStatement({
        actions: ['cloudformation:DeleteStack', 'cloudformation:ListStackResources'],
        resources: [`arn:${Aws.PARTITION}:cloudformation:${Aws.REGION}:${Aws.ACCOUNT_ID}:stack/*`],
        conditions: ephemeralOnly,
      })
    );
    this.role.addToPolicy(
      new PolicyStatement({
        actions: ['ecs:UpdateService'],
        resources: [`arn:${Aws.PARTITION}:ecs:${Aws.REGION}:${Aws.ACCOUNT_ID}:service/*`],
        conditions: ephemeralOnly,
      })
    );
    this.acknowledgeWildcards();
  }

  private acknowledgeWildcards() {
    const validations = Validations.of(this.role);
    validations.acknowledge({
      id: 'AwsSolutions-IAM5[Resource::*]',
      reason:
        'DescribeStacks with no name, which also needs ListStacks, is the only way to list stacks with their tags.',
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

  /**
   * Two alarms to the alerts topic: the reaper erred, or it hasn't run for 30 minutes (three
   * schedule periods; a disabled rule or zero concurrency makes no errors, only silence). The
   * SSL-only topic policy replaces SNS's default one, so the alarms need their own Allow.
   */
  private addAlarms() {
    const errors = this.function
      .metricErrors({ period: Duration.minutes(10), statistic: 'Sum' })
      .createAlarm(this, 'ErrorAlarm', {
        alarmDescription:
          'The supplier-line reaper Lambda failed; stacks may outlive their window.',
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      });
    const heartbeat = this.function
      .metricInvocations({ period: Duration.minutes(30), statistic: 'Sum' })
      .createAlarm(this, 'HeartbeatAlarm', {
        alarmDescription:
          'The supplier-line reaper Lambda has not run for 30 minutes; stacks may outlive their window.',
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
        treatMissingData: TreatMissingData.BREACHING,
      });
    for (const alarm of [errors, heartbeat]) alarm.addAlarmAction(new SnsAction(this.alerts));
    this.alerts.addToResourcePolicy(
      new PolicyStatement({
        sid: 'AllowErrorAlarmPublish',
        principals: [new ServicePrincipal('cloudwatch.amazonaws.com')],
        actions: ['sns:Publish'],
        resources: [this.alerts.topicArn],
        conditions: { ArnEquals: { 'aws:SourceArn': [errors.alarmArn, heartbeat.alarmArn] } },
      })
    );
  }
}
