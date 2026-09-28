# ADR-0007: A rotation handover names the last order found

Status: Accepted.

## Context

Session rotation (FH-05) replays conversation history into the new Sonic connection using the
caller's heard text, but deliberately leaves out any reply built from a tool result: replaying it
would let the new connection speak that PO's data again without calling `get_po_status`, so its
prompt instead tells it to call the tool again for any PO question, including a follow-up. In
practice this left the new connection with no PO code to call the tool with: after a rotation, a
bare follow-up like "and the delivery date?" got "Let me check that." with no tool call at all
(measured 0 of 3 runs), because the reply that had named the order was exactly what history left
out.

## Decision

The session tracks the PO code its most recent successful lookup found (`lastOrder`). When a
rotation opens the next connection, its prompt is `CONTINUED_PROMPT` plus one sentence naming that
order: "The order discussed most recently is purchase order one zero four eight two." When no
lookup has happened yet, the prompt is unchanged.

## Consequences

- Follow-up questions after a rotation reliably trigger a fresh `get_po_status` call grounded in
  the right order, instead of a non-answer.
- Measured over 3 loops at `ROTATE_AFTER_S=60`: follow-ups after a rotation answered correctly 6/6,
  PO questions after a rotation 4/4, and 0 ungrounded answers.
- Adds one session-scoped piece of state (`lastOrder`) to the host; it only ever adds a sentence
  naming a PO code already spoken to the same caller in the same call, so it doesn't expose
  anything the caller hasn't already heard.

## Evidence

- Commit `e3f5281`, "Name the last order found in a rotated connection's prompt" — includes the
  measurement (6/6, 4/4, 0 ungrounded).
- `packages/host/src/sonic/prompt.ts` — `continuedPrompt(lastOrder)`.
- `packages/host/src/sonic/session.ts` — the `lastOrder` field, set from `onToolResult`'s `found`
  argument.
- `packages/host/src/sonic/connection.ts` — `onToolResult(from, name, rendering, found?)`, `found`
  being the PO code the lookup found.
- `packages/host/src/sonic/events.test.ts` — "names the order found last in a continued connection,
  so follow-ups keep it".
- `packages/host/README.md`, "Session rotation (FH-05)".
