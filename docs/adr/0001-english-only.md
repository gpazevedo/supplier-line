# ADR-0001: English (en-US) only

Status: Accepted.

## Context

The plan considered speech in more than one language. Amazon Connect's documented Nova Sonic
voices are Matthew (en-US), Amy (en-GB), Olivia (en-AU) and Lupe (es-US); none is Portuguese
(finding V-10). Switching language mid-call would likely need a new Sonic session, since the
system prompt is fixed at session start (finding L-02), which ties any future language switch to
the session-rotation machinery (FH-05). Building and verifying a second language's renderings,
prompts and fixed phrases would roughly double the surface area of a one-shot build.

## Decision

Supplier Line speaks only English (en-US), on both front doors (the self-hosted softphone and
Amazon Connect). The system prompt, every spoken rendering (money, dates, PO codes) and every
fixed phrase are English-only. Portuguese and all other language handling (L-01 through L-13) are
designed, not built.

## Consequences

- One system prompt, one set of renderings, one set of captured fixed phrases: no
  language-detection or mid-call language switch logic.
- A caller who does not speak English cannot be served; there is no fallback message asking them
  to switch language, since that message would itself need to be understood.
- Adding a second language later means, at minimum, a second Sonic session per language (per L-02),
  new renderings and captured phrases, and a Connect voice check, since not every Nova Sonic voice
  covers every locale.

## Evidence

- `CLAUDE.md`, Decisions table, "Language | English (en-US) only".
- `docs/build-plan.md`, Decisions table (`Language`) and "Out of scope" list, "Portuguese and all
  language handling (L-01 to L-13)".
- `docs/build-plan.md`, Findings table, V-10 (Connect voices) and L-02 (language switch needs a new
  session).
- `packages/host/src/sonic/prompt.ts`, `SYSTEM_PROMPT` (English text only).
- `packages/tools/src/render/date.ts`, `render/po-code.ts` — en-US phrasing only.
