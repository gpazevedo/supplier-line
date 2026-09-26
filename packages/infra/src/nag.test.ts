import { App } from 'aws-cdk-lib';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app';

describe('cdk-nag AwsSolutions', () => {
  it('passes on the whole app', () => {
    const app = buildApp(new App({ context: { expiresAt: '2026-09-26T18:30:00Z' } }));
    expect(() => app.synth()).not.toThrow();
  });
});
