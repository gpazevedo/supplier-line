import { App, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { AppStack } from './app-stack';
import { APP_STACK_NAME } from './config';

/**
 * Builds the CDK app. Context: `expiresAt` (required, ISO 8601 UTC) and `imageTag` (default `latest`).
 * S10's persistent stack is added here, beside the app stack, so cdk-nag covers both.
 */
export function buildApp(app: App = new App()): App {
  new AppStack(app, 'AppStack', {
    stackName: APP_STACK_NAME,
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
    expiresAt: app.node.tryGetContext('expiresAt'),
    imageTag: app.node.tryGetContext('imageTag') ?? 'latest',
  });
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));
  return app;
}
