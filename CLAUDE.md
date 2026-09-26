# Supplier Line

English-only voice agent that answers purchase-order status, built on Amazon Nova 2 Sonic. The full plan is `docs/build-plan.md`; your stream brief comes from its work-streams table.

## Hard rules (every agent)

- In a fresh worktree, run `pnpm install` before anything else.
- AWS: use only `AWS_PROFILE=supplier-dev`. Never use another profile, never read `~/.aws`, never run `aws configure` or `aws sso`.
- Never run `cdk deploy` or `cdk destroy`, never start or approve a GitHub workflow, never touch repo secrets or variables.
- Never use `--no-verify` on a commit or push. A failing hook means the stream is not done.
- Never commit an access code, key or token. Locally the access code comes from the `DEMO_ACCESS_CODE` environment variable; in AWS it comes from SSM.
- If you hit a permission prompt or an access-denied error on a denied action, stop and report it. Do not look for a way around it.

## Infrastructure constraints

- `cdk synth` must succeed with no AWS credentials at all (CI has none, agents are denied CloudFormation). No `fromLookup`, no context lookups at synth time. Anything that needs a lookup (e.g. the CloudFront origin-facing prefix list for the ALB) is resolved at deploy time with a custom resource, or passed as a context value committed in `cdk.json`.
- Region is `us-east-1`. Stacks read account and region from the standard CDK environment variables at deploy time.
- The traces bucket is named `supplier-line-traces-<account-id>`.
- The SSM access-code parameter is created with a placeholder value. The owner sets the real value by hand after deploy.
- App-stack resources carry the tags `ExpiresAt` and `supplier-line:ephemeral=true`; synth fails without them.

## Fixtures

Caller clips live in `fixtures/clips/` as 16 kHz, 16-bit, mono WAV:

| File                    | Content                                             |
| ----------------------- | --------------------------------------------------- |
| `po-status-a.wav`       | PO-status question for a PO from the generated data |
| `po-status-b.wav`       | Same question, different PO                         |
| `interrupt.wav`         | "Wait, stop"                                        |
| `followup-delivery.wav` | "And the delivery date?"                            |
| `silence-3s.wav`        | 3 seconds of silence                                |

The two PO codes spoken in the clips are listed in `fixtures/clips/README.md` and must exist in S02's deterministic data.

## Decisions

| Decision       | Choice                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| Hosting        | AWS `us-east-1`: CloudFront, ALB, Fargate (ARM64), S3, Lambda, Bedrock, Amazon Connect                     |
| Infrastructure | CDK in TypeScript: persistent stack (no hourly charges) and app stack (only during approved windows)       |
| Consent        | App stack deploys only through `demo-up`, gated by approval in GitHub Environment `demo`; window 1–8 hours |
| Enforcement    | Reaper Lambda deletes the app stack at expiry, on a missing or malformed tag, or 8 hours after creation    |
| CI             | `ci.yml` runs every pre-commit hook plus the ARM64 image build, with no AWS credentials                    |
| Language       | English (en-US) only                                                                                       |
| Stack          | TypeScript, from AWS's `websocket-nodejs` Nova 2 Sonic sample; model `amazon.nova-2-sonic-v1:0`            |
| Build platform | Notebook is AMD64, Fargate is ARM64: cross-build with Buildx and QEMU; compile on `$BUILDPLATFORM`         |
| Barge-in       | Model-detected only; browser reports milliseconds played (planned, generated, heard per turn)              |
| Session length | Up to 15 minutes, with rotation (FH-05) before Sonic's 8-minute connection limit                           |
| Access control | Access code checked on WebSocket connect; 15-minute session cap; at most 2 concurrent sessions             |
| Voice          | Matthew on both front doors                                                                                |

## Out of scope: designed, not built

- Portuguese and all language handling (L-01 to L-13)
- Client-detected barge-in (ADR-0003, V-08) and echo handling (FH-09)
- Stream reopen after a failure (FH-02)
- The Claude reasoning tool, supplier verification (SEC-01), degradation modes beyond one fallback prompt
- Cognito, WAF, custom domain, autoscaling, full caller simulator, chaos tests, a real phone number
