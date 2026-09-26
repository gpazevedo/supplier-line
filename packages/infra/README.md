# infra

CDK app stack (S09): VPC (public subnets only, no NAT), Fargate ARM64 host, ALB reachable only from CloudFront, CloudFront with an S3 site and `/ws` and `/api/*` routes. S10's persistent stack joins it in `src/app.ts`.

- `pnpm cdk:check`: `cdk synth` plus cdk-nag (AwsSolutions), with no AWS credentials.
- Context: `expiresAt` (required, ISO 8601 UTC, e.g. `2026-09-26T18:30:00Z`; synth throws without it) and `imageTag` (host image in ECR repo `supplier-line-host`, default `latest`).
- The CloudFront prefix list is looked up at deploy time by a custom resource; AZs come from `Fn::GetAZs`. Synth does no context lookups.

## Reaper (S21)

`ReaperConstruct` (`src/reaper/`), placed by S10 in the persistent stack with `{ alertEmail }`:

- A Lambda runs every 10 minutes and finds stacks tagged `supplier-line:ephemeral=true`. It deletes any whose `ExpiresAt` is past, missing or malformed, or which is older than 8 hours. It scales their ECS services to zero first. A failed delete is emailed and retried on the next run.
- The same Lambda receives CloudFormation Stack Status Change events and emails when a tagged stack is created, deleted, or fails to delete. A CloudWatch alarm on the Lambda's `Errors` metric emails reaper failures.
- IAM: `DescribeStacks` on `*`. `DeleteStack`, `ListStackResources` and `ecs:UpdateService` apply only to resources tagged `supplier-line:ephemeral=true`. `sns:Publish` on the alerts topic, and writes to the reaper's own log group.
- `pnpm reaper:selftest` (owner only, admin credentials, H0 part 2) deploys `supplier-line-reaper-selftest`, a free stack tagged to expire in 5 minutes. Expect the created email, then the deleted email within 15 minutes.
