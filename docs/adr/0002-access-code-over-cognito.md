# ADR-0002: A shared access code instead of Cognito

Status: Accepted.

## Context

The demo app stack is redeployed for each approved window and gets a fresh CloudFront
`cloudfront.net` domain each time (no custom domain, ADR-0004). A Cognito Hosted UI login needs
its callback URLs registered up front, which would have to be re-registered, or worked around,
every time the domain changes. The goal is only to keep strangers who don't have the demo URL from
using the line during a window, not to authenticate individual suppliers.

## Decision

A single access code, generated once and stored in SSM (`/supplier-line/demo-access-code`, a
placeholder until the owner sets it) and as the repo secret `DEMO_ACCESS_CODE`, gates both front
doors: `/ws` checks it as a query parameter before opening any Bedrock connection, and
`POST /api/connect/start` checks it in the JSON request body before calling
`StartWebRTCContact`. No sign-in flow, no per-user identity, no Cognito user pool.

## Consequences

- No redirect-URI management as the CloudFront domain changes between windows.
- The code is a shared secret, not a credential per caller: there is no way to tell which supplier
  called, and leaking the code lets anyone with it use the line until it is rotated (rotate by
  setting a new SSM value and running `demo-down` then `demo-up`, since the host reads it at task
  start).
- The SSM parameter is a plain `String`, not a `SecureString`, because CloudFormation cannot create
  a `SecureString`; the comparison isn't constant-time and the code travels in the `/ws` query
  string. Accepted for a demo gate (`docs/review-s19.md`, N3); the owner can recreate it as a
  `SecureString` by hand if wanted.
- Supplier verification proper (SEC-01) remains out of scope; the code only gates the line, not
  which PO data a caller may ask about.

## Evidence

- `packages/host/src/sessions.ts:115` — rejects a WebSocket with code `4401` when the access code is
  missing or wrong.
- `packages/host/src/server.ts:76-78` — `POST /api/connect/start` returns 401 before ever calling
  `StartWebRTCContact`.
- `packages/host/README.md`, "Access control and limits (S17)".
- `docs/diagrams/architecture.svg` note: "Access code instead of Cognito... keeps strangers out
  without login redirects that break whenever the CloudFront domain changes."
- `docs/review-s19.md`, N3 (access code handling) and N2 (`/api/connect/start` not counted toward
  the 2-session cap, but still access-code gated).
- `CLAUDE.md` / `docs/build-plan.md`, Decisions table, "Access control".
