import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { describe, expect, it } from 'vitest';

const dir = fileURLToPath(new URL('../../../.github/workflows/', import.meta.url));

interface Workflow {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<
    string,
    {
      environment?: string;
      permissions?: Record<string, string>;
      'runs-on': string;
      steps: { uses?: string; run?: string; if?: string }[];
    }
  >;
}

const files = readdirSync(dir).filter((f) => f.endsWith('.yml'));
const text = (name: string) => readFileSync(dir + name, 'utf8');
const workflow = (name: string) => parse(text(name)) as Workflow;

describe('workflows', () => {
  it('are the four expected ones', () => {
    expect(files.sort()).toEqual(['ci.yml', 'demo-down.yml', 'demo-up.yml', 'infra-deploy.yml']);
  });

  it('only demo-up references the demo environment or the demo role variable', () => {
    for (const name of files.filter((f) => f !== 'demo-up.yml')) {
      const yaml = text(name);
      const environments = Object.values(workflow(name).jobs).map((j) => j.environment);
      expect(environments, name).not.toContain('demo');
      expect(yaml, name).not.toMatch(/DEMO_ROLE_ARN/);
      expect(yaml, name).not.toMatch(/environment:\s*demo\s*$/m);
    }
  });

  it('ci has no AWS credentials or id-token permission', () => {
    const ci = workflow('ci.yml');
    const permissions = [ci.permissions, ...Object.values(ci.jobs).map((j) => j.permissions)];
    for (const p of permissions) expect(p?.['id-token']).toBeUndefined();
    expect(stringify(ci)).not.toMatch(/aws|secrets\.|vars\.|id-token/i);
  });

  it('only ci and demo-down run on non-manual triggers', () => {
    for (const name of files) {
      const triggers = Object.keys(workflow(name).on).filter((t) => t !== 'workflow_dispatch');
      const expected = { 'ci.yml': ['push', 'pull_request'], 'demo-down.yml': ['schedule'] };
      expect(triggers, name).toEqual(expected[name as keyof typeof expected] ?? []);
    }
  });

  it('declare permissions on the workflow and on every job that needs more', () => {
    for (const name of files) {
      const w = workflow(name);
      expect(w.permissions, name).toBeDefined();
      for (const job of Object.values(w.jobs)) {
        if (w.permissions?.contents !== 'read') expect(job.permissions, name).toBeDefined();
      }
    }
  });

  it('pin every action to a full commit SHA, with its version as a comment', () => {
    for (const name of files) {
      const uses = [...text(name).matchAll(/uses:\s*(\S+)(.*)$/gm)];
      expect(uses.length, name).toBeGreaterThan(0);
      for (const [, ref, comment] of uses) {
        expect(ref, name).toMatch(/^[\w-]+\/[\w-]+@[0-9a-f]{40}$/);
        expect(comment, name).toMatch(/#\s*v\d+\.\d+\.\d+/);
      }
    }
  });

  it('run on a fixed Ubuntu, not ubuntu-latest', () => {
    for (const name of files) {
      for (const job of Object.values(workflow(name).jobs)) {
        expect(job['runs-on'], name).toBe('ubuntu-24.04');
      }
    }
  });
});

describe('demo-up', () => {
  const { deploy, smoke } = workflow('demo-up.yml').jobs;
  const runs = (steps: { run?: string }[]) => steps.map((s) => s.run ?? '');

  it('uploads the built web pages to the site bucket before waiting on CloudFront', () => {
    const steps = runs(deploy.steps);
    const sync = steps.findIndex((r) =>
      /aws s3 sync packages\/web\/dist s3:\/\/supplier-line-site-/.test(r)
    );
    const build = steps.findIndex((r) => r.includes('pnpm --filter web build'));
    const wait = steps.findIndex((r) => r.includes('curl --fail'));
    expect(build).toBeGreaterThan(-1);
    expect(sync).toBeGreaterThan(build);
    expect(wait).toBeGreaterThan(sync);
  });

  it("checks the live run's own traces, including a 7-minute scenario that must rotate", () => {
    const steps = runs(smoke.steps);
    expect(
      steps.some((r) => /replay-clips .*--long-seconds 420 .*--require-rotation/.test(r))
    ).toBe(true);
    const check = smoke.steps.find((s) => s.run?.includes('pnpm check:traces'));
    expect(check?.run).toMatch(/pnpm check:traces "\$PWD\/traces\/live"/);
    expect(check?.if).toBe('always()');
  });

  it('keeps the smoke job free of AWS access and Environments', () => {
    expect(smoke.environment).toBeUndefined();
    expect(smoke.permissions).toEqual({ contents: 'read' });
    expect(stringify(smoke)).not.toMatch(/aws-actions|id-token/);
  });
});
