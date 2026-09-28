# ADR-0006: Digit-by-digit PO codes, and holding a lookup started mid-code

Status: Accepted.

## Context

Sonic sometimes ends the caller's turn, and calls `get_po_status`, before the caller has finished
reading all five digits of a PO code — filling the missing digits with zeros or a guess. Saying
codes with an explicit "dash" word ("P O dash one zero four eight two") also read awkwardly and
didn't match how callers naturally read the code back. A wrong code must never return another
supplier's order data.

## Decision

PO codes are rendered digit by digit with no dash or letter grouping beyond "PO" itself: "PO-10482"
speaks as "one zero four eight two". Separately, if the model calls `get_po_status` while the
caller has said one to four digits of a code in the current turn, the host holds the lookup —
answering `{"ok":false,"reason":"caller_still_reading"}` without running it — until the caller has
said all five digits or 4 seconds pass, then lets the model call again with the whole code. Every
mis-heard code still fails its check digit and gets "please say it again."

## Consequences

- A caller who pauses mid-code (for example, between groups of digits) briefly delays the answer
  instead of getting a lookup run on a partial, zero-filled code.
- The turn's trace records `early_tool_calls` so a partial-read pattern is visible without
  guessing.
- `endpointingSensitivity: LOW` is required for this to work well: with `MEDIUM`, Sonic ended the
  caller's turn inside a pause in a slowly read code often enough to matter.
- The check digit remains the backstop: even a code the model mis-hears in full (not mid-read) fails
  validation and gets "please say it again," rather than another order's data.

## Evidence

- `packages/tools/src/render/po-code.ts` — `renderPoCode`, digit by digit, no dash.
- `packages/host/src/sonic/reading.ts` — `callerStillReading`, `midCode`, `STILL_READING_RESULT`.
- Commit `ba9c9e3c`, "Hold lookups the caller has not finished reading; stop the agent saying
  'P O dash'".
- `packages/host/README.md`, "Tool calls" — `endpointingSensitivity: LOW` and the early-lookup hold.
- `README.md`, "Known issues" — "Sonic still occasionally mishears a code... the check digit turns
  every mishearing into 'please say it again'."
