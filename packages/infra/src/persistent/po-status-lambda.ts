import { fileURLToPath } from 'node:url';
import { Duration } from 'aws-cdk-lib';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Architecture, Function as LambdaFn, Runtime } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import { bundledCode } from '../reaper/bundle';

const ENTRY = fileURLToPath(new URL('../../../tools/src/po-status/lambda.ts', import.meta.url));

/** S04's Lex V2 fulfillment Lambda for `get_po_status`. Its role may only write its own log group. */
export function createPoStatusLambda(scope: Construct): LambdaFn {
  const role = new Role(scope, 'PoStatusRole', {
    assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
  });
  const logGroup = new LogGroup(scope, 'PoStatusLogs', { retention: RetentionDays.ONE_MONTH });
  logGroup.grantWrite(role);
  return new LambdaFn(scope, 'PoStatus', {
    code: bundledCode(ENTRY),
    handler: 'index.handler',
    runtime: Runtime.NODEJS_24_X,
    architecture: Architecture.ARM_64,
    timeout: Duration.seconds(10),
    role,
    logGroup,
  });
}
