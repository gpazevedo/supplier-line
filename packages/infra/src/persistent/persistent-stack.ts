import { Annotations, CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { ReaperConstruct } from '../reaper/reaper-construct';
import { createBudget } from './budgets';
import { createConnect } from './connect';
import { createGithubRoles } from './github-roles';
import { createPoStatusLambda } from './po-status-lambda';
import {
  createAccessCodeParameter,
  createConnectIdParameters,
  createRepository,
  createTracesBucket,
} from './storage';

export interface PersistentStackProps extends StackProps {
  /** Receives reaper and budget alerts. A deploy-time context value, never committed. */
  alertEmail: string | undefined;
}

/**
 * Everything with no hourly charge: ECR, traces, access code, PO status Lambda, Connect and Lex,
 * GitHub OIDC roles, the reaper and budgets.
 */
export class PersistentStack extends Stack {
  constructor(scope: Construct, id: string, props: PersistentStackProps) {
    super(scope, id, props);
    const alertEmail = this.requireAlertEmail(props.alertEmail);
    const repository = createRepository(this);
    createTracesBucket(this);
    createAccessCodeParameter(this);
    const connect = createConnect(this, createPoStatusLambda(this));
    createConnectIdParameters(this, connect.instance.attrId, connect.flow.attrContactFlowArn);
    const roles = createGithubRoles(this, repository);
    new ReaperConstruct(this, 'Reaper', { alertEmail });
    createBudget(this, alertEmail);

    new CfnOutput(this, 'DemoRoleArn', { value: roles.demo.roleArn });
    new CfnOutput(this, 'TeardownRoleArn', { value: roles.teardown.roleArn });
    new CfnOutput(this, 'InfraRoleArn', { value: roles.infra.roleArn });
    new CfnOutput(this, 'ConnectInstanceId', { value: connect.instance.attrId });
    new CfnOutput(this, 'ContactFlowArn', { value: connect.flow.attrContactFlowArn });
  }

  /** Errors on this stack only, so app-stack-only commands still synth without the email. */
  private requireAlertEmail(value: string | undefined): string {
    if (value) return value;
    Annotations.of(this).addError('Missing context alertEmail: pass -c alertEmail=you@example.com');
    return 'missing@example.invalid';
  }
}
