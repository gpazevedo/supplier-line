import { App } from 'aws-cdk-lib';
import { SELFTEST_STACK_NAME, selftestExpiresAt, SelftestStack } from './selftest-stack';

const app = new App();
new SelftestStack(app, 'ReaperSelftest', {
  stackName: SELFTEST_STACK_NAME,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  expiresAt: selftestExpiresAt(new Date()),
});
app.synth();
