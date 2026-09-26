import { App } from 'aws-cdk-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app';

const context = { expiresAt: '2026-09-26T18:30:00Z', alertEmail: 'owner@example.com' };

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Synthesizes both stacks and bundles two Lambdas: slower than the default 5 s under a parallel run. */
describe('cdk-nag AwsSolutions', { timeout: 30_000 }, () => {
  it('passes on the whole app', () => {
    const app = buildApp(new App({ context }));
    expect(() => app.synth()).not.toThrow();
  });

  it('passes with a concrete account and region, as at deploy time', () => {
    vi.stubEnv('CDK_DEFAULT_ACCOUNT', '111122223333');
    vi.stubEnv('CDK_DEFAULT_REGION', 'us-east-1');
    const app = buildApp(new App({ context }));
    expect(() => app.synth()).not.toThrow();
  });
});
