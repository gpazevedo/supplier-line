import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { PersistentStack } from './persistent-stack';

const ISSUER = 'token.actions.githubusercontent.com';
const ENVIRONMENT_SUBS = ['demo', 'teardown', 'infra'].map(
  (env) => `repo:gpazevedo@54742084/supplier-line@1389281503:environment:${env}`
);

interface Statement {
  Action: string | string[];
  Effect: string;
  Condition?: Record<string, Record<string, unknown>>;
  Resource?: unknown;
}
type Resources = ReturnType<Template['findResources']>;
type Resource = Resources[string];

let template: Template;
let roles: Resources;

beforeAll(() => {
  template = Template.fromStack(
    new PersistentStack(new App(), 'Persistent', { alertEmail: 'owner@example.com' })
  );
  roles = template.findResources('AWS::IAM::Role');
});

const trustOf = (role: Resource): Statement[] => role.Properties.AssumeRolePolicyDocument.Statement;

const githubTrusted = () =>
  Object.entries(roles).filter(([, role]) =>
    JSON.stringify(trustOf(role)).includes(`:oidc-provider/${ISSUER}`)
  );

/** Every statement of the inline policies attached to the role with this logical ID prefix. */
function policyOf(prefix: string): Statement[] {
  const [id] = Object.keys(roles).filter((r) => r.startsWith(prefix));
  return Object.values(template.findResources('AWS::IAM::Policy'))
    .filter((p) => JSON.stringify(p.Properties.Roles).includes(id))
    .flatMap((p) => p.Properties.PolicyDocument.Statement);
}

const actionsOf = (statements: Statement[]) => statements.flatMap((s) => [s.Action].flat());

describe('GitHub OIDC trust', () => {
  it('trusts GitHub only through the three roles', () => {
    expect(githubTrusted()).toHaveLength(3);
  });

  it("reuses the account's existing GitHub OIDC provider", () => {
    template.resourceCountIs('AWS::IAM::OIDCProvider', 0);
  });

  it('pins each role to exactly one Environment sub: no branch, no wildcard', () => {
    const subs = githubTrusted().map(([, role]) => {
      const statements = trustOf(role);
      expect(statements).toHaveLength(1);
      const [{ Action, Effect, Condition }] = statements;
      expect(Action).toBe('sts:AssumeRoleWithWebIdentity');
      expect(Effect).toBe('Allow');
      expect(Object.keys(Condition ?? {})).toEqual(['StringEquals']);
      expect(Condition?.StringEquals).toEqual({
        [`${ISSUER}:aud`]: 'sts.amazonaws.com',
        [`${ISSUER}:sub`]: expect.any(String),
      });
      const trust = JSON.stringify(statements);
      expect(trust).not.toMatch(/ref:|refs\/|branch|\*|\?/);
      return Condition?.StringEquals[`${ISSUER}:sub`];
    });
    expect(subs.sort()).toEqual([...ENVIRONMENT_SUBS].sort());
  });
});

describe('GitHub role permissions', () => {
  it('lets only the demo role push to ECR', () => {
    expect(actionsOf(policyOf('GithubDemoRole'))).toContain('ecr:PutImage');
    for (const prefix of ['GithubTeardownRole', 'GithubInfraRole']) {
      expect(actionsOf(policyOf(prefix)).some((a) => a.startsWith('ecr:'))).toBe(false);
    }
  });

  it('lets only the demo role upload the web pages, to the site bucket only', () => {
    const s3 = policyOf('GithubDemoRole').filter((s) =>
      [s.Action].flat().some((a) => a.startsWith('s3:'))
    );
    expect(s3.map((s) => [s.Action].flat().sort())).toEqual([
      ['s3:ListBucket'],
      ['s3:DeleteObject', 's3:PutObject'],
    ]);
    expect(JSON.stringify(s3[0].Resource)).toMatch(
      /:::supplier-line-site-",\{"Ref":"AWS::AccountId"\}\]/
    );
    expect(JSON.stringify(s3[1].Resource)).toMatch(
      /:::supplier-line-site-",\{"Ref":"AWS::AccountId"\},"\/\*"\]/
    );
    for (const prefix of ['GithubTeardownRole', 'GithubInfraRole']) {
      expect(actionsOf(policyOf(prefix)).some((a) => a.startsWith('s3:'))).toBe(false);
    }
  });

  it('gives the teardown role no CDK bootstrap roles and no way to create or update a stack', () => {
    const actions = actionsOf(policyOf('GithubTeardownRole'));
    expect(actions).not.toContain('sts:AssumeRole');
    expect(actions.filter((a) => a.startsWith('cloudformation:')).sort()).toEqual([
      'cloudformation:DeleteStack',
      'cloudformation:DescribeStackResources',
      'cloudformation:DescribeStacks',
    ]);
  });

  it('lets the infra role only assume the CDK deploy and file-publishing roles', () => {
    const [statement, ...rest] = policyOf('GithubInfraRole');
    expect(rest).toHaveLength(0);
    expect(statement.Action).toBe('sts:AssumeRole');
    expect(JSON.stringify(statement.Resource)).toMatch(/cdk-hnb659fds-deploy-role-/);
    expect(JSON.stringify(statement.Resource)).toMatch(/cdk-hnb659fds-file-publishing-role-/);
    expect(statement.Resource).toHaveLength(2);
  });
});
