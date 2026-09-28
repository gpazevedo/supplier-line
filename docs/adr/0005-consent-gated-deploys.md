# ADR-0005: Consent-gated deploys, with independent layers

Status: Accepted.

## Context

The ALB and Fargate service (the app stack) cost money per hour they run and must never start
without the owner's explicit, in-the-moment consent — not from an agent acting on its own, not from
a scheduled job, and not from a plain push to `main`. A single control (say, just a manual workflow)
can fail or be misconfigured; the build plan asked for defence in depth.

## Decision

Five independent layers each separately prevent the app stack from running without consent, so that
one layer failing still leaves the others standing:

1. **Approval gate.** `demo-up` is the only workflow whose AWS role can reach the app stack, and it
   deploys into the GitHub Environment `demo`, which requires the owner's approval on every run.
2. **No automatic deploys.** `ci.yml`, which runs on every push and pull request, has no AWS
   credentials and no `id-token` permission at all.
3. **Agent limits.** The `supplier-dev` AWS profile agents use explicitly denies `ecs:*`,
   `elasticloadbalancing:*`, `cloudformation:*`, `iam:*`, `ec2:RunInstances` and `sts:AssumeRole`.
4. **Time limit.** The reaper Lambda runs every 10 minutes, deletes any tagged app stack whose
   `ExpiresAt` has passed, is missing, or is malformed, or which is older than 8 hours regardless of
   its tag, and scales Fargate to zero first so billing stops even if deletion is slow.
5. **Visibility.** Email alerts on stack created/deleted/delete-failed and on reaper errors; AWS
   Budgets alerts at $10 and $30.

## Consequences

- No fully unattended demo: a human must click Approve in the `demo` Environment every time,
  including at H3 and H4.
- The worst case if a window is approved and forgotten is bounded: 8 hours of the app stack running,
  about 60 cents (`docs/build-plan.md`, AWS cost table).
- A stream or agent that tries to deploy or start a workflow gets an access-denied error, by design;
  the orchestrator's rule is to report it and carry on, not to look for a way around it.
- `infra-deploy`'s role could, through the CDK deploy role's own permissions, deploy any stack; only
  the workflow file (which deploys `PersistentStack --exclusively`) and the `infra` Environment's
  required approval keep it to the persistent stack (`docs/review-s19.md`, S6) — a real gap between
  what IAM technically allows and what the workflow does, left as owner hardening (restrict
  Deployment branches to `main` on both `demo` and `infra`).

## Evidence

- `.github/workflows/demo-up.yml` — `environment: demo`.
- `.github/workflows/ci.yml` — `permissions: contents: read` only, no AWS action anywhere in the
  file.
- `supplier-dev-policy.json`, `HardDeny` statement.
- `packages/infra/README.md`, "Reaper (S21)".
- `docs/build-plan.md`, "Consent controls" table and "AWS cost" table.
- `docs/review-s19.md`, N5 (IAM audit) and S6 (infra-deploy's role can deploy more than the workflow
  file uses; owner hardening: restrict Deployment branches to `main`).
