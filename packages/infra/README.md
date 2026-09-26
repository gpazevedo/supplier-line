# infra

CDK app stack (S09): VPC (public subnets only, no NAT), Fargate ARM64 host, ALB reachable only from CloudFront, CloudFront with an S3 site and `/ws` and `/api/*` routes. S10's persistent stack joins it in `src/app.ts`.

- `pnpm cdk:check`: `cdk synth` plus cdk-nag (AwsSolutions), with no AWS credentials.
- Context: `expiresAt` (required, ISO 8601 UTC, e.g. `2026-09-26T18:30:00Z`; synth throws without it) and `imageTag` (host image in ECR repo `supplier-line-host`, default `latest`).
- The CloudFront prefix list is looked up at deploy time by a custom resource; AZs come from `Fn::GetAZs`. Synth does no context lookups.
