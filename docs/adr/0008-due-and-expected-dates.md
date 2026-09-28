# ADR-0008: Speak both the due date and the expected date for a delayed order

Status: Accepted.

## Context

A delayed purchase order has two dates that matter to a supplier: when delivery was originally due,
and when it's now expected. Speaking only the new date would read as if the order had always been
due then; speaking only the original due date would omit the one thing a supplier calling about a
delayed order actually wants to know.

## Decision

`renderPo`'s delivery sentence always speaks `dueDate`. When `status` is `delayed`, it also
requires and speaks a separate `expectedDate`: "Delivery was due on `<due>` and is now expected on
`<expected>`." If a delayed PO has no `expectedDate`, rendering throws rather than silently omitting
or guessing one. The data generator only ever sets `expectedDate` for delayed orders, always later
than `dueDate`.

## Consequences

- A delayed order's rendering is unambiguous: the caller hears both the original commitment and the
  current one.
- Every other status (open, shipped, delivered, cancelled) has no `expectedDate` field at all, so
  there's no ambiguity about when it applies.
- A future change that produces a delayed order without an `expectedDate` fails loudly (a thrown
  `RangeError`) at rendering time, instead of the agent quietly saying only one date.

## Evidence

- `packages/tools/src/po-status/render.ts:17-33` — `deliverySentence`, the `delayed` case and its
  `RangeError` guard when `expectedDate` is missing.
- `packages/tools/src/data/generate.ts:46-47` — `expectedDate` is set only when `status === 'delayed'`,
  as `dueDate` plus 1–14 days.
- `packages/tools/src/data/types.ts:22-23` — "Present only when `status` is `delayed`; always later
  than `dueDate`."
- `README.md` — "the date delivery is due (plus the new expected date when an order is delayed)".
