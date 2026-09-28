# ADR-0004: Two CDK stacks — persistent and app

Status: Accepted.

## Context

Some resources should exist all the time at near-zero cost, and should survive being torn down and
rebuilt: the ECR image repository, the traces bucket, the access-code SSM parameter, the Amazon
Connect instance and its manually-configured speech-to-speech bot (setting that up again after
every demo would be wasted manual work), the reaper, GitHub's OIDC roles, and the budget alerts.
Other resources — the ALB, the Fargate service and CloudFront — exist only to serve traffic during
an approved window and should be trivial to create and destroy without disturbing anything else.

## Decision

Split the infrastructure into two independent CDK stacks in `packages/infra/src/app.ts`:
`PersistentStack` (`supplier-line-persistent`), deployed once by the owner and updated only through
the approval-gated `infra-deploy` workflow; and `AppStack` (`supplier-line-app`), deployed only by
`demo-up` and torn down by `demo-down` or the reaper. `AppStack` reads the persistent stack's
resources by fixed, predictable names (the ECR repo `supplier-line-host`, the traces bucket
`supplier-line-traces-<account-id>`, the SSM parameter) rather than CloudFormation cross-stack
exports, so the two stacks can be created and destroyed on independent schedules.

## Consequences

- The app stack can be destroyed and recreated freely without losing the Connect bot's manually
  set speech-to-speech configuration, the ECR image history, or committed traces.
- Every `AppStack` resource must carry the `ExpiresAt` and `supplier-line:ephemeral=true` tags for
  the reaper to find and delete it; synth refuses to produce a stack without them.
- The two stacks cannot share CloudFormation outputs/imports (which would couple their lifecycles);
  naming resources predictably instead means a typo in a name is a runtime failure, not a synth-time
  one — caught instead by the CDK assertion tests asserting the exact names and ARNs used.

## Evidence

- `packages/infra/README.md` — "CDK app stack (S09)... The persistent stack (S10) sits beside it in
  `src/app.ts`".
- `packages/infra/src/app-stack.ts:25-26` — `Tags.of(this).add('ExpiresAt', requireExpiresAt(...))`
  and `Tags.of(this).add('supplier-line:ephemeral', 'true')`.
- `packages/infra/src/expiry.ts` — `requireExpiresAt` throws on a missing or malformed value.
- `docs/review-s19.md`, N4 — "Synth refuses an app stack without both tags (`app-stack.ts:25-26`)".
- `docs/build-plan.md`, Decisions table, "Infrastructure", and Architecture section, "Connect lives
  in the persistent stack. It has no hourly charge, and the manual speech-to-speech setting survives
  every teardown."
