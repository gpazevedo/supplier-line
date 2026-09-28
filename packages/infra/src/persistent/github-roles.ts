import { Aws, Validations } from 'aws-cdk-lib';
import type { IRepository } from 'aws-cdk-lib/aws-ecr';
import {
  type IOidcProvider,
  OidcProviderNative,
  PolicyStatement,
  Role,
  WebIdentityPrincipal,
} from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import { APP_STACK_NAME, GITHUB_REPO, SITE_BUCKET_PREFIX } from '../config';
import { EPHEMERAL_TAG } from '../reaper/rules';

const ISSUER = 'token.actions.githubusercontent.com';

export type GithubEnvironment = 'demo' | 'teardown' | 'infra';

export interface GithubRoles {
  demo: Role;
  teardown: Role;
  infra: Role;
}

/** ARN of a role created by `cdk bootstrap` with the default qualifier. */
function bootstrapRoleArn(kind: string): string {
  return `arn:${Aws.PARTITION}:iam::${Aws.ACCOUNT_ID}:role/cdk-hnb659fds-${kind}-role-${Aws.ACCOUNT_ID}-${Aws.REGION}`;
}

const assumeCdkDeployRoles = () =>
  new PolicyStatement({
    actions: ['sts:AssumeRole'],
    resources: [bootstrapRoleArn('deploy'), bootstrapRoleArn('file-publishing')],
  });

/** Pseudo-parameters rather than the stack's env, so the ARN (and its cdk-nag ID) is the same everywhere. */
const APP_STACK_ARN = `arn:${Aws.PARTITION}:cloudformation:${Aws.REGION}:${Aws.ACCOUNT_ID}:stack/${APP_STACK_NAME}/*`;
const ECS_SERVICES_ARN = `arn:${Aws.PARTITION}:ecs:${Aws.REGION}:${Aws.ACCOUNT_ID}:service/*`;

/** Allows `actions` on the app stack only; the trailing `*` is its stack ID, new on every deploy. */
function allowOnAppStack(role: Role, actions: string[]) {
  role.addToPolicy(new PolicyStatement({ actions, resources: [APP_STACK_ARN] }));
  Validations.of(role).acknowledge({
    id: `AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:cloudformation:<AWS::Region>:<AWS::AccountId>:stack/${APP_STACK_NAME}/*]`,
    reason:
      'The trailing * is the stack ID, which changes on every deploy; the stack name is fixed.',
  });
}

/** A role only a job running in GitHub Environment `env` of this repo can assume. */
function environmentRole(scope: Construct, provider: IOidcProvider, env: GithubEnvironment) {
  return new Role(scope, `Github${env[0].toUpperCase()}${env.slice(1)}Role`, {
    description: `GitHub Actions, Environment ${env} of ${GITHUB_REPO} only`,
    assumedBy: new WebIdentityPrincipal(provider.oidcProviderArn, {
      StringEquals: {
        [`${ISSUER}:aud`]: 'sts.amazonaws.com',
        [`${ISSUER}:sub`]: `repo:${GITHUB_REPO}:environment:${env}`,
      },
    }),
  });
}

const SITE_BUCKET_ARN = `arn:${Aws.PARTITION}:s3:::${SITE_BUCKET_PREFIX}${Aws.ACCOUNT_ID}`;

/** `aws s3 sync --delete` of the built web pages into the app stack's site bucket, and nothing else. */
function grantSiteUpload(role: Role) {
  role.addToPolicy(
    new PolicyStatement({ actions: ['s3:ListBucket'], resources: [SITE_BUCKET_ARN] })
  );
  role.addToPolicy(
    new PolicyStatement({
      actions: ['s3:PutObject', 's3:DeleteObject'],
      resources: [`${SITE_BUCKET_ARN}/*`],
    })
  );
  Validations.of(role).acknowledge({
    id: `AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:s3:::${SITE_BUCKET_PREFIX}<AWS::AccountId>/*]`,
    reason: 'Object keys are the built page files; the bucket holds only the public static site.',
  });
}

/** demo-up: push the host image, deploy the app stack through the CDK bootstrap roles, read its outputs, upload the pages. */
function grantDemo(role: Role, repository: IRepository) {
  repository.grantPullPush(role);
  grantSiteUpload(role);
  role.addToPolicy(assumeCdkDeployRoles());
  allowOnAppStack(role, ['cloudformation:DescribeStacks']);
  Validations.of(role).acknowledge({
    id: 'AwsSolutions-IAM5[Resource::*]',
    reason: 'ecr:GetAuthorizationToken has no resource-level permissions.',
  });
}

/**
 * demo-down: scale the app stack's ECS service to zero and delete the stack directly.
 * No CDK bootstrap roles, so this unapproved Environment can never create or update a stack.
 * CloudFormation deletes with the stack's own execution role, which this role may pass.
 */
function grantTeardown(role: Role) {
  allowOnAppStack(role, [
    'cloudformation:DescribeStacks',
    'cloudformation:DescribeStackResources',
    'cloudformation:DeleteStack',
  ]);
  role.addToPolicy(
    new PolicyStatement({
      actions: ['iam:PassRole'],
      resources: [bootstrapRoleArn('cfn-exec')],
      conditions: { StringEquals: { 'iam:PassedToService': 'cloudformation.amazonaws.com' } },
    })
  );
  role.addToPolicy(
    new PolicyStatement({
      actions: ['ecs:UpdateService'],
      resources: [ECS_SERVICES_ARN],
      conditions: { StringEquals: { [`aws:ResourceTag/${EPHEMERAL_TAG}`]: 'true' } },
    })
  );
  Validations.of(role).acknowledge({
    id: 'AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:ecs:<AWS::Region>:<AWS::AccountId>:service/*]',
    reason: `Service names are generated per deploy; aws:ResourceTag limits it to ${EPHEMERAL_TAG}=true.`,
  });
}

/**
 * One role per GitHub Environment, each trusted only for that Environment's `sub` claim,
 * never a branch. The account's GitHub OIDC provider already exists (IAM allows one per URL),
 * so it is referenced by ARN, not created.
 */
export function createGithubRoles(scope: Construct, repository: IRepository): GithubRoles {
  const provider = OidcProviderNative.fromOidcProviderArn(
    scope,
    'GithubOidc',
    `arn:${Aws.PARTITION}:iam::${Aws.ACCOUNT_ID}:oidc-provider/${ISSUER}`
  );
  const roles = {
    demo: environmentRole(scope, provider, 'demo'),
    teardown: environmentRole(scope, provider, 'teardown'),
    infra: environmentRole(scope, provider, 'infra'),
  };
  grantDemo(roles.demo, repository);
  grantTeardown(roles.teardown);
  roles.infra.addToPolicy(assumeCdkDeployRoles());
  return roles;
}
