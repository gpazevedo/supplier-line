# Supplier Line

An English-only voice agent that tells suppliers the status of a purchase order. It runs on Amazon
Nova 2 Sonic (`amazon.nova-2-sonic-v1:0`) in AWS `us-east-1`, behind a browser softphone and an
Amazon Connect front door.

A caller says a code such as "P O one zero four eight two". The agent looks it up with the
`get_po_status` tool and speaks the tool's rendering word for word: status, amount, order date, and
the date delivery is due (plus the new expected date when an order is delayed, [ADR-0008](docs/adr/0008-due-and-expected-dates.md)).
Any single wrong digit fails the code's check digit, so a misheard code gets "please say it again"
instead of another order's data.

## Architecture

![Architecture](docs/diagrams/architecture.svg)

- **CloudFront in front of everything.** It gives the browser HTTPS, on a free `cloudfront.net`
  domain, and carries the WebSocket to the ALB, which only accepts traffic from CloudFront.
- **Public subnets, no NAT gateway.** The Fargate task gets a public IP instead.
- **Access code instead of Cognito** ([ADR-0002](docs/adr/0002-access-code-over-cognito.md)): a code
  in SSM, checked on WebSocket connect and on `/api/connect/start`, without login redirects that
  would break every time the CloudFront domain changes.
- **Session rotation.** Nova 2 Sonic closes a connection after 8 minutes, so the host opens a fresh
  one in the background after 6 minutes and hands the conversation over, following AWS's own
  session-continuation pattern ([ADR-0007](docs/adr/0007-rotation-names-last-order.md)).
- **Barge-in is model-detected only** ([ADR-0003](docs/adr/0003-model-detected-barge-in.md)): the
  browser reports milliseconds played, generated and planned per turn; it runs no local
  voice-activity detection.
- **Connect lives in the persistent stack** ([ADR-0004](docs/adr/0004-two-cdk-stacks.md)): no
  hourly charge, and the manually configured speech-to-speech setting survives every teardown.

See [the session host diagram](docs/diagrams/session-host.svg) for what happens inside the host
during one call, and [the AI SDLC diagram](docs/diagrams/ai-sdlc.svg) for how this repo is built.

## Consent controls

The ALB and Fargate app stack never runs without the owner's approval. Five independent layers
each separately prevent it — full detail in [ADR-0005](docs/adr/0005-consent-gated-deploys.md):

1. **Approval gate.** Only `demo-up` can create the app stack, and it deploys into the GitHub
   Environment `demo`, which requires the owner's approval every run.
2. **No automatic deploys.** `ci.yml` runs on every push with no AWS credentials at all.
3. **Agent limits.** Agents' AWS profile (`supplier-dev`) explicitly denies `ecs:*`,
   `elasticloadbalancing:*`, `cloudformation:*`, `iam:*`, `ec2:RunInstances` and `sts:AssumeRole`.
4. **Time limit.** A reaper Lambda checks every 10 minutes and deletes the app stack past its
   `ExpiresAt`, with a missing or malformed tag, or 8 hours after creation — whichever comes first —
   scaling Fargate to zero first.
5. **Visibility.** Email alerts on stack created/deleted/failed and on reaper errors; AWS Budgets
   alerts at $10 and $30.

Worst case, if a window is approved and forgotten: about 8 hours running, roughly 60 cents.

## Status

| Area                                                                          | State |
| ----------------------------------------------------------------------------- | ----- |
| PO data, renderings, `get_po_status`, traces and trace checks, viewer         | Built |
| Session host: Sonic streaming, barge-in, playback ledger, session rotation    | Built |
| Softphone and trace viewer, WCAG 2.2 AA checked with axe                      | Built |
| Caller-clip player, fixed phrases                                             | Built |
| CDK persistent and app stacks, reaper, GitHub workflows                       | Built |
| Access code, 15-minute cap, 2 concurrent sessions, `/api/connect/start` (S17) | Built |
| Failure behaviours: fallback phrase, filler at 1.5 s, tool retry (S14)        | Built |
| Connect calling page (S18), pending a human's audio check                     | Built |
| Final review (S19): `docs/review-s19.md`                                      | Built |
| README and ADRs (S20)                                                         | Built |

**Verified at H3** ([demo-up run 36642547863](https://github.com/gpazevedo/supplier-line/actions/runs/36642547863), 2026-09-29): the app stack deployed on Fargate, and the live smoke job replayed all six caller-clip scenarios against it, including a rotation at 381 s with no caller audio lost. All six traces passed the six trace checks. They are committed as `fixtures/traces/h3-live-*.json`, so CI checks real deployed behaviour from now on. Earlier `demo-up` runs failed and were fixed first; see `docs/review-s19.md` and ADR-0006.

Known issues:

- Sonic still occasionally mishears a code (for example it hears only three digits). The host holds
  any lookup the caller has not finished reading, and the check digit turns every mishearing into
  "please say it again," so no other order's data is spoken
  ([ADR-0006](docs/adr/0006-digit-codes-and-early-lookup-hold.md)). Across rotations, codes and
  follow-ups are answered through the tool
  ([ADR-0007](docs/adr/0007-rotation-names-last-order.md)).
- S18: the Connect calling page (`packages/web/connect.html`) is built and axe-checked,
  `/api/connect/start` checks the same access code as `/ws`, but a real call and the flow's error
  branch still need a human with a mic and speakers (see `packages/web/README.md`); there's no
  automated end-to-end check for the Connect path.

## Built versus designed

Everything in "Status" above is built. These are designed but intentionally not built, so the scope
stayed small enough for one pass:

- Portuguese and all language handling (L-01 to L-13) — [ADR-0001](docs/adr/0001-english-only.md)
- Client-detected barge-in and echo handling (FH-09) — [ADR-0003](docs/adr/0003-model-detected-barge-in.md)
- Stream reopen after a failure (FH-02)
- The Claude reasoning tool, supplier verification (SEC-01), and degradation modes beyond one
  fallback prompt
- Cognito sign-in, WAF, a custom domain, autoscaling, the full caller simulator, chaos tests, and a
  real phone number

## Run it locally

Needs Node.js LTS, pnpm and an AWS profile with Bedrock access (`supplier-dev`).

```bash
pnpm install
export DEMO_ACCESS_CODE=<any local code>          # never commit it
AWS_PROFILE=supplier-dev pnpm --filter host dev   # host on :8080
pnpm --filter web dev                             # open /softphone.html, enter the code
```

Use headphones. Each session writes `traces/<session-id>.json`. Open the viewer (`index.html` on
the same dev server) and drop a trace file on it to see planned, generated and heard audio per
turn.

Host settings: `PORT`, `TRACE_DIR` (or `TRACES_BUCKET`, as on Fargate), and `ROTATE_AFTER_S`
(default 360; set 60 to hear rotations).

Replay recorded caller clips instead of talking (both commands read `DEMO_ACCESS_CODE`):

```bash
pnpm --filter host replay "$PWD/fixtures/clips/po-status-a.wav" PO-10482
pnpm --filter scripts run replay-clips -- --url ws://localhost:8080/ws --out traces/live
```

## Checks

```bash
pnpm typecheck && pnpm test && pnpm cdk:check && pnpm check:traces
```

pre-commit runs formatting, linting and secret scanning on every commit. Typecheck, tests
(including the axe WCAG 2.2 AA check), CDK checks and trace checks run on every push. CI (`ci.yml`)
runs the same hooks plus an ARM64 image build that starts the container and waits for its own
health check, with no AWS credentials at any point.

## Deploy

Only the owner deploys, and never an agent ([ADR-0005](docs/adr/0005-consent-gated-deploys.md)).
The app stack exists only during a window you approve:

- `demo-up`: a manual workflow, approved in the GitHub Environment `demo`. It deploys the app stack
  for 1–8 hours (default 1), then runs a live smoke job against it.
- `demo-down` removes it early. The reaper Lambda deletes it at expiry in any case.
- The persistent stack (ECR, traces bucket, access code, Connect, reaper, alerts) has no hourly
  charges and is updated only through the approval-gated `infra-deploy` workflow.

One-time setup: [INSTALL.md](INSTALL.md) and [docs/h0-part2.md](docs/h0-part2.md).

## Cost notes

Approximate, `us-east-1`, from `docs/build-plan.md`'s cost table — estimates, not measured; H3
verified behaviour, not cost:

| Item                                                       | When charged                 | Cost                                 |
| ---------------------------------------------------------- | ---------------------------- | ------------------------------------ |
| App stack (ALB, Fargate ARM 0.5 vCPU/1 GB, CloudFront)     | Only during approved windows | ~7 cents/hour                        |
| Persistent stack (ECR, S3, Lambdas, SSM, Connect instance) | Always                       | ~$1–3/month, mostly storage          |
| Nova 2 Sonic                                               | Per conversation minute      | ~1.5 cents/minute                    |
| Connect browser call                                       | Per minute                   | $0.048 (voice service + web calling) |

Two 1-hour demo windows (H3 and H4) cost about 15 cents in infrastructure.

## Layout

| Path               | Contents                                                     |
| ------------------ | ------------------------------------------------------------ |
| `packages/host`    | Session host: `/ws`, Sonic sessions, rotation, replay client |
| `packages/tools`   | PO data, renderings, `get_po_status`, fixed phrases          |
| `packages/traces`  | Trace schema, writers, `check:traces`                        |
| `packages/web`     | Softphone and trace viewer                                   |
| `packages/infra`   | CDK stacks and the reaper                                    |
| `packages/scripts` | Caller-clip player                                           |
| `fixtures/clips`   | Recorded caller clips                                        |
| `assets/phrases`   | Fixed phrases spoken by Sonic                                |

## Decisions

Short ADRs for decisions worth remembering, each with context, consequences and evidence:
[docs/adr/](docs/adr/README.md). Final review findings: [docs/review-s19.md](docs/review-s19.md).

## How it is built

A Claude Code orchestrator drives one agent per work stream, each in its own git worktree,
following [docs/build-plan.md](docs/build-plan.md). Every stream passes the hooks, an independent
check against real Bedrock, and CI before it merges. See
[the AI SDLC diagram](docs/diagrams/ai-sdlc.svg).
