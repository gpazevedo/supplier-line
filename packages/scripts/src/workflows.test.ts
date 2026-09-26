import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { describe, expect, it } from 'vitest';

const dir = fileURLToPath(new URL('../../../.github/workflows/', import.meta.url));

interface Workflow {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, { environment?: string; permissions?: Record<string, string> }>;
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
});
