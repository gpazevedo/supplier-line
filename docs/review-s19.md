# S19 final review

Sep 27, 2026, on `s19` from `main` 62f3193. Covers security, IAM least privilege, the consent controls, WCAG 2.2 AA, correctness and readability, across every package and workflow.

Baseline before any fix: `pnpm typecheck`, `pnpm test` (396 tests), `pnpm cdk:check` (cdk-nag clean) and `pnpm check:traces` (9 traces) all passed. Every green check here ran with mocks or synth only. Nothing has ever run the container image, the deployed IAM policies, or the live smoke job. Most blocking findings sit in exactly those gaps.

Severity: **blocking** means H3 (`demo-up` plus the live smoke) or the demo would fail, or the host can be crashed remotely. **Should-fix** is a real defect or risk that doesn't stop H3. **Note** is a judgement or a hardening idea.

Status marks how each finding ended on this branch: **fixed** (with the tests named), **owner** (needs the owner) or **open**.

## Blocking

### B1. The host image crashes at startup: `assets/` isn't in the image (fixed)

- **Where:** `packages/host/src/phrases/fixed.ts:5`, `packages/host/src/phrases/notices.ts:5`, `Dockerfile:17`.
- **Evidence:** both loaders resolve `../../../../assets/` from `import.meta.url`. That path is right for `src/phrases/*.ts`, but in the bundle it resolves from `/app/dist/main.js` to `/assets/`, and the runtime stage copies only the `pnpm deploy` output (`dist/`, `package.json`). Reproduced: `pnpm --filter host build && pnpm --filter host deploy --prod <dir>`, then `node dist/main.js` exits with `ENOENT … assets/notices/one-minute-warning.wav` before listening. On Fargate the task would never pass its health check, the circuit breaker would roll back, and `cdk deploy` in `demo-up` would fail. CI only builds the image and never runs it.
- **Fix:** loaders take the directory from `assetsDir()`, which reads `ASSETS_DIR` when set and falls back to the repo's `assets/`. The Dockerfile copies `assets/` and sets `ASSETS_DIR`. `ci.yml`'s image job now loads the ARM64 image and waits for its Docker health check under QEMU, which was S08's done criterion.
- **Tests:** `packages/host/src/phrases/assets.test.ts`; the CI health step.

### B2. The task role grants an IAM action that doesn't exist, so every deployed call gets AccessDenied (fixed)

- **Where:** `packages/infra/src/host-service.ts:74`; `app-stack.test.ts:118` asserted the wrong action.
- **Evidence:** the policy grants `bedrock:InvokeModelWithBidirectionalStream`. The Bedrock API reference for `InvokeModelWithBidirectionalStream` says: "This operation requires permission for the `bedrock:InvokeModel` action." AWS's machine-readable service reference (`servicereference.us-east-1.amazonaws.com/v1/bedrock/bedrock.json`) lists no action by that name. IAM accepts unknown action strings silently, and cdk-nag doesn't check them. The agent profile (`supplier-dev-policy.json`) grants only `bedrock:InvokeModel`, and Sonic works locally with it. This is the same class of bug as the reaper's missing `ListStacks`: a mocked test encoded the mistake.
- **Fix:** grant `bedrock:InvokeModel` on the Nova 2 Sonic foundation-model ARN only.
- **Tests:** `app-stack.test.ts` now asserts the exact task-role action set.

### B3. The task role has no `connect:StartWebRTCContact`, so the Connect page fails when deployed (fixed)

- **Where:** `packages/infra/src/host-service.ts:72-93`; the call is at `packages/host/src/server.ts:70`.
- **Evidence:** no statement in either stack grants `connect:StartWebRTCContact`. It works locally only because `supplier-dev` allows it on `*`. Deployed, `/api/connect/start` would return 502, and demo video step 6 would fail. The service reference lists the action's resource as `contact-flow` (`arn:…:connect:…:instance/<id>/contact-flow/<id>`).
- **Fix:** grant it on exactly that contact flow. The IDs come from the persistent stack's SSM parameters as CloudFormation SSM parameter types, which resolve at deploy time, not synth. cdk-nag needs no wildcard exception.
- **Tests:** `app-stack.test.ts`.

### B4. The deployed host writes traces nowhere: local disk it can't write, never S3 (fixed)

- **Where:** `packages/host/src/main.ts:11-12,33`; `host-service.ts:88-93` grants `s3:PutObject` that nothing uses.
- **Evidence:** `main.ts` always uses `localTraceWriter(TRACE_DIR ?? '../../../traces/')`. In the image that resolves to `/traces/` (`new URL('../../../traces/', 'file:///app/dist/main.js')` gives `file:///traces/`), and the container runs as `node`, which can't create directories under `/`. `writer.write` would throw, `sessions.ts:195-198` would close every call with `1011 session failed`, and no trace would ever be written. The known item "the deployed host writes traces to the S3 traces bucket" is not true of the current code: `s3TraceWriter` exists but is never used.
- **Fix:** when `TRACES_BUCKET` is set (the task definition sets `supplier-line-traces-<account>`), the host writes with `s3TraceWriter`.
- **Tests:** `packages/host/src/trace-writer.test.ts`; the task-definition environment in `app-stack.test.ts`.

### B5. The live smoke job checks no live traces and no rotation (fixed)

- **Where:** `.github/workflows/demo-up.yml:114`, `packages/traces/src/cli.ts:4-6`, `packages/scripts/src/replay-clips-args.ts:22`.
- **Evidence:** `pnpm check:traces` reads only `packages/traces/samples/` and `fixtures/traces/`. `replay-clips --out traces/live` writes agent WAVs and `report.json`, not traces, so the smoke job re-checks committed files. The long scenario defaults to 180 s. The deployed host rotates after 360 s (`ROTATE_AFTER_S` default), so no rotation happens, and nothing requires one. Acceptance requires "the live smoke job in `demo-up` passes including the rotation scenario".
- **Fix:** no new AWS access. The host already sends `{type: 'trace', path}` when a session ends, and now includes the trace itself (the caller's own session, which the caller already heard). `replay-clips` saves it as `<scenario>.trace.json` in `--out`. `check:traces <dir…>` checks only the given directories and fails when they hold no trace. `demo-up`'s smoke job runs the long scenario for 420 s with `--require-rotation`, so that scenario fails without at least one `FH-05` event, and then runs `pnpm check:traces "$PWD/traces/live"`. The smoke job keeps no AWS credentials. Traces also land in S3 (B4) for later review.
- **Tests:** `check-traces.test.ts`, `sessions.test.ts`, `replay-clips-args.test.ts` and `workflows.test.ts`.

### B6. Nothing uploads the web pages, so CloudFront serves an empty bucket (fixed)

- **Where:** `packages/infra/src/site.ts:17-31`, `.github/workflows/demo-up.yml:76-79`.
- **Evidence:** the repo has no `BucketDeployment` and no `s3 sync`. `SiteBucketName` is exported "for demo-up", but demo-up never uses it. Through Origin Access Control, a missing key returns 403, so `curl --fail … "$SITE_URL"` retries for 5 minutes and fails the deploy job. Even if it passed, there would be no softphone to open.
- **Fix:** the site bucket gets a fixed name, `supplier-line-site-<account-id>`. `demo-up` builds `packages/web` and runs `aws s3 sync --delete` into it before waiting on CloudFront. The demo role is granted `s3:ListBucket`, `s3:PutObject` and `s3:DeleteObject` on that bucket only.
- **Tests:** `app-stack.test.ts`, `github-roles.test.ts`, `workflows.test.ts`.

### B7. One unauthenticated request crashes the host (fixed)

- **Where:** `packages/host/src/server.ts:37-46,63`.
- **Evidence:** reproduced against `pnpm --filter host dev`. `curl -X POST /api/connect/start -d 'null'` gives `TypeError: Cannot read properties of null (reading 'code')`. The rejection escapes `void startConnectContact(...)`, Node exits, and `/health` stops answering. Anyone who finds the CloudFront URL can end every call in progress, with no access code needed.
- **Fix:** anything but a JSON object reads as `{}`, so the request gets a 401.
- **Tests:** `server.test.ts`.

## Should-fix

### S1. A malformed WebSocket text frame crashes the host (fixed)

- **Where:** `packages/host/src/sessions.ts:183`.
- **Evidence:** reproduced. Connecting with the code and `?fault=fh01` (no Bedrock call), then sending the text frame `not json`, gives `SyntaxError: Unexpected token 'o'`, and the process exits, taking the other concurrent session down too. It needs the access code, so it isn't blocking.
- **Fix:** ignore a text frame that isn't valid JSON.
- **Tests:** `sessions.test.ts`.

### S2. `/api/connect/start` buffers an unbounded body before checking the code (fixed)

- **Where:** `packages/host/src/server.ts:37-40`.
- **Evidence:** every chunk is kept until the request ends, before the access-code check, so an unauthenticated client can stream an arbitrarily large body into a 1 GB task.
- **Fix:** answer 413 once a body passes 4 KiB, before the code check.
- **Tests:** `server.test.ts`.

### S3. Workflow actions: out-of-date majors, marked UNVERIFIED, not pinned (fixed)

- **Where:** header comments and `uses:` lines in all four workflows.
- **Evidence:** from the GitHub releases API on Sep 27, 2026, each release's `action.yml` declares `runs.using: node24`:

  | Action                                  | Pinned before | Latest | Commit     |
  | --------------------------------------- | ------------- | ------ | ---------- |
  | `actions/checkout`                      | v5            | v7.0.1 | `3d3c42e5` |
  | `actions/setup-node`                    | v5            | v7.0.0 | `82076278` |
  | `pnpm/action-setup`                     | v4 (Node 20)  | v6.1.0 | `ea17c68d` |
  | `aws-actions/configure-aws-credentials` | v5            | v6.3.0 | `e1253824` |
  | `aws-actions/amazon-ecr-login`          | v2            | v2.1.7 | `03f1aad4` |
  | `docker/setup-qemu-action`              | v3            | v4.4.0 | `99012661` |
  | `docker/setup-buildx-action`            | v3            | v4.4.1 | `f87e5991` |
  | `docker/build-push-action`              | v6            | v7.4.0 | `c3c9e263` |
  | `actions/upload-artifact`               | v5            | v7.0.1 | `043fb46d` |

  None of the breaking changes touch this repo's usage: node24 runtimes; setup-node v6 limits automatic caching to npm, but the explicit `cache: pnpm` still works; buildx v4 removes deprecated inputs this repo doesn't use. pnpm/action-setup v6.1.0 adds pnpm 12 support (the repo uses 12.6.0). `demo-up` runs with an OIDC token that can reach AWS, so tags that can be moved are a supply-chain risk.

- **Fix:** every action is pinned to its full commit SHA, with the version as a comment. `runs-on: ubuntu-24.04` replaces `ubuntu-latest`, so the move of `ubuntu-latest` to Ubuntu 26 on 2026-10-19 can't change QEMU or Buildx behaviour in the middle of a demo window.
- **Tests:** `workflows.test.ts` asserts that every `uses:` is pinned to a SHA.

### S4. Stale comment in `demo-up.yml` (fixed)

- **Where:** `.github/workflows/demo-up.yml:103`: "Placeholder: S16 adds the `replay-clips` script". S16 is merged. The comment has been removed.

### S5. The reaper can fail silently by not running at all (fixed)

- **Where:** `packages/infra/src/reaper/reaper-construct.ts:122-143`.
- **Evidence:** the only alarm is on `Errors` with missing data treated as not breaching. If the schedule rule is disabled or deleted, or the function is throttled or its concurrency is set to 0, there are no invocations, no errors and no email: exactly the "reaper fails silently" risk in the plan. The error path is otherwise sound. `reapOrAlert` emails and then rethrows, the handler throws, the alarm publishes, and the topic policy allows the alarm (tested since 0df62fc).
- **Fix:** a second alarm, `HeartbeatAlarm`: fewer than one invocation in 30 minutes (three schedule periods), with missing data treated as breaching, to the same topic. The topic-policy `ArnEquals` allows both alarms.
- **Tests:** `reaper-construct.test.ts`.

### S6. "infra-deploy can't create the app stack" overstates it (fixed in comments; owner hardening)

- **Where:** `.github/workflows/infra-deploy.yml:4`, `packages/infra/src/persistent/github-roles.ts:122`.
- **Evidence:** the infra and demo roles both assume the same `cdk-hnb659fds-deploy-role`, whose execution role has administrator rights by default. The infra role can therefore deploy any stack, including the app stack. The workflow file only deploys `PersistentStack`. Consent still holds, because the `infra` Environment also needs the owner's approval, but the separation lives in the workflow file, not in IAM.
- **Fix:** the comment says what's true. **Owner:** in both the `demo` and `infra` Environments, set Deployment branches to `main` only, so a workflow pushed on another branch can't even request approval with those roles.

### S7. Deprecated `CfnResource#addDependency` (fixed)

- **Where:** `packages/infra/src/persistent/connect.ts:40`; `cdk synth` warns that it "will be removed in the next major release". Replaced with `addResourceDependency`.

### S8. The viewer's host-trace picker calls an endpoint that doesn't exist (open, for S20)

- **Where:** `packages/web/src/load.ts:19-31`, `packages/web/src/main.ts:32-39`.
- **Evidence:** the host serves only `/health`, `/ws` and `/api/connect/start`, so the picker never appears (its errors are swallowed). The plan says the viewer reads "local files or the host's `/api/traces`". With B5, the softphone gets each trace at hang-up. Serving S3 traces from the host would need `s3:GetObject` and `s3:ListBucket` on the task role, and would show every caller's traces to anyone with the code.
- **Proposal:** remove the picker and say the viewer opens files. That's S20's call when it checks claims against the code.

## Notes

- **N1. Viewer card borders (`--border`, about 1.5:1).** Keep as they are. WCAG 1.4.11 covers boundaries needed to identify user-interface components, and graphics needed to understand content. The Playwright audit shows each card is an `article` with an h3 ("Turn 0, 910 ms voice to voice") and nothing focusable inside. The border only groups content that the heading and spacing already separate, so the criterion doesn't apply. Every border that does identify a control passes: the access-code field is 4.54:1 (light) and 5.13:1 against the page (dark), the Call button over 18:1, and the focus outline is 3 px `--fg`, over 16:1.
- **N2. `/api/connect/start` isn't counted in the 2-session cap.** Acceptable. It needs the access code (S17). Each contact costs $0.048 a minute only while the flow runs, and the flow disconnects on caller silence (`InputTimeLimitExceeded` routes to the error message, then disconnect). The Lex session idles out at 300 s, and Connect's per-instance concurrent-call quota bounds parallel calls. The $10 budget alert and "rotate the code, run demo-down" cover abuse. If the code leaks, rotate it: the SSM value is read at task start, so run `demo-down` and then `demo-up`.
- **N3. Access code handling.** The SSM parameter is a plain `String`, because CloudFormation can't create a `SecureString`. The comparison isn't constant-time, and the code travels in the `/ws` query string. No CloudFront or ALB access logs are enabled, and the host doesn't log URLs. All acceptable for a demo gate. Hardening, if wanted: the owner can recreate the parameter as `SecureString` (the ECS execution role reads the default `aws/ssm` key without extra grants).
- **N4. The reaper only sees stacks tagged `supplier-line:ephemeral=true`.** A stack without that tag is invisible to it, and its delete permission is scoped to that tag. Synth refuses an app stack without both tags (`app-stack.ts:25-26`), and only the owner-approved `demo-up` can deploy one, so this is by design. `demo-down` (nightly) deletes `supplier-line-app` by name regardless of tags.
- **N5. IAM audit: every AWS call against its grant.** Actions and condition keys checked against the Service Authorization Reference.

  | Principal                   | Calls made                                                                                                                                          | Grant                                                                                                                      | Verdict                                                                                                                                                                                                                                                        |
  | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Host task role              | Bedrock bidirectional stream; `StartWebRTCContact`; S3 `PutObject` (after B4)                                                                       | was the wrong action, no Connect grant; now `bedrock:InvokeModel` on the model, Connect on the flow, `PutObject` on traces | B2, B3 fixed                                                                                                                                                                                                                                                   |
  | Host execution role         | ECR pull, logs, SSM `GetParameters` for 3 parameters                                                                                                | CDK-generated                                                                                                              | OK                                                                                                                                                                                                                                                             |
  | Reaper                      | `DescribeStacks` (no name, which also needs `ListStacks`), `ListStackResources`, `DeleteStack`, `ecs:UpdateService`, `sns:Publish`, logs            | `*` for listing; the rest scoped by `aws:ResourceTag/supplier-line:ephemeral`                                              | OK: `DeleteStack` and `ListStackResources` support `aws:ResourceTag` (CloudFormation reference), and so does ECS `service`. `DeleteStack` without `RoleARN` uses the stack's own role, so no `PassRole` is needed                                              |
  | PO status Lambda            | logs only                                                                                                                                           | its log group                                                                                                              | OK                                                                                                                                                                                                                                                             |
  | Lex bot role                | `polly:SynthesizeSpeech`                                                                                                                            | `*` (no resource-level support)                                                                                            | OK                                                                                                                                                                                                                                                             |
  | Prefix-list custom resource | `ec2:DescribeManagedPrefixLists`                                                                                                                    | `*`                                                                                                                        | OK                                                                                                                                                                                                                                                             |
  | Demo role                   | ECR login and push; `sts:AssumeRole` on the CDK deploy and file-publishing roles; `DescribeStacks` on the app stack; S3 sync to the site (after B6) | as listed                                                                                                                  | OK after B6                                                                                                                                                                                                                                                    |
  | Teardown role               | `DescribeStacks`, `DescribeStackResources`, `DeleteStack` on the app stack; `ecs:UpdateService` on tagged services                                  | as listed, plus `iam:PassRole` on `cfn-exec`                                                                               | `PassRole` is probably unused (the CLI call passes no `--role-arn`). It's left in place, because removing it can't be tested without a live `demo-down`, and it allows nothing but passing that role to CloudFormation, which this role can only use to delete |
  | Infra role                  | `sts:AssumeRole` on the CDK roles                                                                                                                   | as listed                                                                                                                  | See S6                                                                                                                                                                                                                                                         |

- **N6. Readability.** `pcmFromWav` is duplicated in `phrases/fixed.ts`, `phrases/notices.ts` and `replay/wav.ts`; import the one in `replay/wav.ts`. Left for later, since it's not worth the churn this late.
- **N7. Fault flags (`?fault=fh01|fh03|fh10`) also work on the deployed host,** for anyone with the code. That's intended for the demo video.

## WCAG 2.2 AA

**Automated:** `packages/web/src/a11y.test.ts` runs axe (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`) on all three pages in real Chrome, in their idle, in-call and error states. It passes.

**Manual pass by the agent** (Playwright with the local Chrome, light and dark):

- **Keyboard:** the tab order is logical on every page. Viewer: file picker. Softphone and Connect: Access code, then Call. Nothing traps focus. Every focused control shows a 3 px outline (over 16:1) and stays in view.
- **Names and roles:** landmarks (`main`), one h1 per page, h2 and h3 structure in the viewer. The access-code fields are labelled "Access code". Buttons are named, the call state has `role="status"`, transcript and call logs are named lists in `aria-live="polite"` regions, and errors use `role="alert"`.
- **Contrast:** see N1. Control borders pass in both schemes.
- **Reflow (1.4.10):** no horizontal scroll at 320 CSS px on any page, including the viewer with the rotation sample loaded.
- **Target size (2.5.8):** the smallest target is the Call button, 51 × 35 px.

**The owner must check by ear**, with NVDA and Chrome on Windows, or VoiceOver and Safari on macOS:

1. Softphone: Tab to the access-code field. It should announce as a protected or secure edit field named "Access code". Tab to "Call" and press Enter.
2. The status changes ("Connecting", "On a call", "Call ended") are announced once each, without moving focus.
3. The button's new name ("Hang up") is announced when focus returns to it.
4. Agent transcript lines are announced politely, without cutting off the agent's own audio mid-word. Judge whether announcing every line is too chatty over headphones.
5. A wrong code: the rejection reason is announced.
6. Connect page: the same flow. Call-log entries are announced, and "Call ended" plus the reason after hang-up.
7. Viewer: open a sample trace with the keyboard (Enter on the picker). With heading navigation (H), each turn is reachable as "Turn N, … ms voice to voice", and the planned, generated and heard values read as text. Loading a non-trace JSON file announces the error.
8. At 200% zoom, the softphone and viewer are still usable.

## What the owner must do

1. **Redeploy the persistent stack** (the infra role, the reaper's heartbeat alarm, the Connect flow dependency change) through `infra-deploy`, or from the notebook as in `docs/h0-part2.md`. Confirm the new "Heartbeat" alarm is `OK` after 30 minutes. Then repeat `docs/h0-part2.md` step 6, points 2 and 3, only if the bot was rebuilt (this change doesn't touch the bot definition).
2. **Set Deployment branches to `main`** in the `demo` and `infra` Environments (S6).
3. **H3:** run `demo-up` for 1 hour and approve it. Expect roughly 10 minutes of smoke: five short scenarios, then the 7-minute rotation scenario. Then download the `live-traces` artifact.
4. Do the by-ear screen-reader checks above.
5. Optional: recreate `/supplier-line/demo-access-code` as a `SecureString` (N3).
