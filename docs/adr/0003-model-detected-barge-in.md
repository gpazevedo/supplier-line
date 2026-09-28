# ADR-0003: Barge-in is model-detected only

Status: Accepted.

## Context

An interruption can be detected two ways: client-side, by running voice-activity detection in the
browser while agent audio is still playing and telling the host to stop; or model-side, by waiting
for Nova 2 Sonic's own turn-taking model to signal that the caller interrupted. Client-detected
barge-in needs the browser to tell the difference between the caller's mic picking up the agent's
own audio (an echo) and a real interruption, which needs echo handling (FH-09) — unverified and
harder to get right within a one-shot build (V-08).

## Decision

Supplier Line detects barge-in only from Sonic's own signal: when a `contentEnd` event reports
`stopReason: 'INTERRUPTED'`, the host treats the current turn as interrupted. The browser runs no
local voice-activity detection and never preempts playback on its own; it only reacts to the
host's `flush` message. Client-detected barge-in, and the echo handling it would require, are
designed, not built.

## Consequences

- No echo-cancellation or local VAD code in the softphone; the playback worklet only plays audio
  and reports what it played, and drops its queue when told to.
- Barge-in latency is bounded by how fast Sonic itself notices the interruption plus the time for
  the client to confirm the flush (`bargein.at_ms` to `audio.flush_latency_ms`, target 300 ms from
  M-01) — not by a client-side reaction time.
- A caller whose own background noise or side conversation doesn't register as speech to Sonic will
  not interrupt the agent; this is a real limitation this build accepts, not a design gap to fix
  with more client logic.

## Evidence

- `packages/host/src/sonic/turns.ts:49` — `if (name === 'contentEnd' && body.stopReason ===
'INTERRUPTED') this.onInterrupted(atMs);` — the only place a barge-in is recognised.
- `packages/host/README.md`, "Playback ledger and barge-in".
- `CLAUDE.md` / `docs/build-plan.md`, Decisions table, "Barge-in | Model-detected only (V-03)...".
- `CLAUDE.md` / `docs/build-plan.md`, "Out of scope: designed, not built" — "Client-detected barge-in
  (ADR-0003, V-08) and echo handling (FH-09)".
- `docs/build-plan.md` Acceptance table, "Fast flush" check (`bargein.at_ms`,
  `audio.flush_latency_ms`).
