import { App, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { AppStack } from './app-stack';
import { APP_STACK_NAME, PERSISTENT_STACK_NAME } from './config';
import { PersistentStack } from './persistent/persistent-stack';

/**
 * Builds the CDK app. Context: `expiresAt` (required, ISO 8601 UTC), `imageTag` (default `latest`)
 * and `alertEmail` (required to deploy PersistentStack). cdk-nag covers both stacks.
 */
export function buildApp(app: App = new App()): App {
  const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };
  new AppStack(app, 'AppStack', {
    stackName: APP_STACK_NAME,
    env,
    expiresAt: app.node.tryGetContext('expiresAt'),
    imageTag: app.node.tryGetContext('imageTag') ?? 'latest',
  });
  new PersistentStack(app, 'PersistentStack', {
    stackName: PERSISTENT_STACK_NAME,
    env,
    terminationProtection: true,
    alertEmail: app.node.tryGetContext('alertEmail'),
  });
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));
  return app;
}
