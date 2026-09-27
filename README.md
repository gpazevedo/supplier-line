# Supplier Line

An English-only voice agent that tells suppliers the status of a purchase order. It runs on Amazon Nova 2 Sonic (`amazon.nova-2-sonic-v1:0`) in AWS `us-east-1`, behind a browser softphone and an Amazon Connect front door.

A caller says a code such as "P O dash one zero four eight two". The agent looks it up with the `get_po_status` tool and speaks the tool's rendering word for word. Any single wrong digit fails the code's check digit, so a misheard code gets "please say it again" instead of another order's data.

![Architecture](docs/diagrams/architecture.svg)

## Status

| Area                                                                                       | State       |
| ------------------------------------------------------------------------------------------ | ----------- |
| PO data, renderings, `get_po_status`, traces and trace checks, viewer                      | Built       |
| Session host: Sonic streaming, barge-in, playback ledger, session rotation                 | Built       |
| Softphone and trace viewer, WCAG 2.2 AA checked with axe                                   | Built       |
| Caller-clip player, fixed phrases                                                          | Built       |
| CDK persistent and app stacks, reaper, GitHub workflows                                    | Built       |
| Access code and session limits (S17), failure behaviours (S14), Connect calling page (S18) | In progress |
| Final review (S19), README and ADRs (S20)                                                  | Planned     |

Known issue: after a session rotation, Sonic sometimes mishears the PO code. A fix is in progress.

## Run it locally

Needs Node.js LTS, pnpm and an AWS profile with Bedrock access (`supplier-dev`).

```bash
pnpm install
AWS_PROFILE=supplier-dev pnpm --filter host dev   # host on :8080
pnpm --filter web dev                             # open /softphone.html
```

Use headphones. Each session writes `traces/<session-id>.json`. Open the viewer (`index.html` on the same dev server) to see planned, generated and heard audio per turn.

Host settings: `PORT`, `TRACE_DIR`, and `ROTATE_AFTER_S` (default 360; set 60 to hear rotations).

Replay recorded caller clips instead of talking:

```bash
pnpm --filter host replay "$PWD/fixtures/clips/po-status-a.wav" PO-10482
pnpm --filter scripts run replay-clips -- --url ws://localhost:8080/ws --out traces/live
```

## Checks

```bash
pnpm typecheck && pnpm test && pnpm cdk:check && pnpm check:traces
```

pre-commit runs formatting, linting and secret scanning on every commit. Typecheck, tests (including the axe check), CDK checks and trace checks run on every push. CI runs the same hooks and the ARM64 image build, with no AWS credentials.

## Deploy

Only the owner deploys, and never an agent. The app stack exists only during a window you approve:

- `demo-up`: a manual workflow, approved in the GitHub Environment `demo`. It deploys the app stack for 1–8 hours (default 1).
- `demo-down` removes it early. The reaper Lambda deletes it at expiry in any case.
- The persistent stack (ECR, traces bucket, access code, Connect, reaper, alerts) has no hourly charges.

One-time setup: [INSTALL.md](INSTALL.md) and [docs/h0-part2.md](docs/h0-part2.md).

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

## How it is built

A Claude Code orchestrator drives one agent per work stream, each in its own git worktree, following [docs/build-plan.md](docs/build-plan.md). Every stream passes the hooks, an independent check against real Bedrock, and CI before it merges. See [the AI SDLC diagram](docs/diagrams/ai-sdlc.svg) and [the session host diagram](docs/diagrams/session-host.svg).
