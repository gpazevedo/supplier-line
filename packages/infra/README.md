# infra

CDK app stack (S09): VPC (public subnets only, no NAT), Fargate ARM64 host, ALB reachable only from CloudFront, CloudFront with an S3 site and `/ws` and `/api/*` routes. The persistent stack (S10) sits beside it in `src/app.ts`.

- `pnpm cdk:check`: `cdk synth` of both stacks plus cdk-nag (AwsSolutions), with no AWS credentials and a dummy `alertEmail`.
- Context: `expiresAt` (required, ISO 8601 UTC, e.g. `2026-09-26T18:30:00Z`; synth throws without it), `imageTag` (host image in ECR repo `supplier-line-host`, default `latest`) and `alertEmail` (required for `PersistentStack` only; never committed).

## Persistent stack (S10)

`PersistentStack` (`supplier-line-persistent`, `src/persistent/`), no hourly charges, termination-protected:

- ECR repo `supplier-line-host`; traces bucket `supplier-line-traces-<account-id>` (S3-encrypted, private, TLS only); SSM `/supplier-line/demo-access-code` holding a placeholder.
- PO status Lambda bundled from `packages/tools/src/po-status/lambda.ts`; Lex V2 bot (en_US, `PoStatus` intent, `PoDigits` slot of five digits) fulfilled by it through the `live` alias; Connect instance with the bot associated and a flow whose error branch plays an error message.
- GitHub OIDC provider and three roles, each trusted only for its Environment's `sub`. `demo`: push to ECR, CDK deploy and file-publishing roles. `infra`: the same two CDK roles. `teardown`: no CDK roles; describe and delete `supplier-line-app`, pass the CDK execution role to CloudFormation, scale ephemeral ECS services.
- The reaper, and a monthly budget emailing at $10 and $30.

Owner deploy steps: `docs/h0-part2.md`.

- The CloudFront prefix list is looked up at deploy time by a custom resource; AZs come from `Fn::GetAZs`. Synth does no context lookups.

## Reaper (S21)

`ReaperConstruct` (`src/reaper/`), placed by S10 in the persistent stack with `{ alertEmail }`:

- A Lambda runs every 10 minutes and finds stacks tagged `supplier-line:ephemeral=true`. It deletes any whose `ExpiresAt` is past, missing or malformed, or which is older than 8 hours. It scales their ECS services to zero first. A failed delete is emailed and retried on the next run.
- The same Lambda receives CloudFormation Stack Status Change events and emails when a tagged stack is created, deleted, or fails to delete. A CloudWatch alarm on the Lambda's `Errors` metric emails reaper failures.
- IAM: `DescribeStacks` on `*`. `DeleteStack`, `ListStackResources` and `ecs:UpdateService` apply only to resources tagged `supplier-line:ephemeral=true`. `sns:Publish` on the alerts topic, and writes to the reaper's own log group.
- `pnpm reaper:selftest` (owner only, admin credentials, H0 part 2) deploys `supplier-line-reaper-selftest`, a free stack tagged to expire in 5 minutes. Expect the created email, then the deleted email within 15 minutes.
