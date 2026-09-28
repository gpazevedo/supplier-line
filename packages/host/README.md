# host

Session host: `GET /health`, `POST /api/connect/start`, and Nova 2 Sonic sessions with
`get_po_status` on the `/ws` WebSocket.

## Run locally and replay a clip

```bash
DEMO_ACCESS_CODE=let-me-in AWS_PROFILE=supplier-dev pnpm --filter host dev   # listens on :8080
DEMO_ACCESS_CODE=let-me-in pnpm --filter host replay "$PWD/fixtures/clips/po-status-a.wav" PO-10482
DEMO_ACCESS_CODE=let-me-in pnpm --filter host replay "$PWD/fixtures/clips/po-status-a.wav" PO-10482 --interrupt-after 2000
ROTATE_AFTER_S=60 DEMO_ACCESS_CODE=let-me-in AWS_PROFILE=supplier-dev pnpm --filter host dev   # rotate every minute
pnpm --filter host replay "$PWD/fixtures/clips/po-status-a.wav" PO-10482 --loop 180 --code let-me-in
```

`DEMO_ACCESS_CODE` is required for the host; it refuses to start without it. `replay` and
`replay-clips` (the caller-clip player) both need the _same_ code to get past the host's access
check on `/ws` (S17): `replay` reads `DEMO_ACCESS_CODE` from the environment, or takes `--code`
explicitly; `replay-clips` always reads it from the environment (see `replay-clips.ts`). A wrong or
missing code, or the 2-session cap, makes the host reject the connection and close it; both the
`runClip` helper they share and the `replay` CLI report that and exit non-zero within a couple of
seconds, rather than waiting out the no-answer timeout.

The replay streams the clip in real time, plays the agent audio on a wall clock, waits for the answer to finish playing, then prints the transcript beside the expected rendering. `--interrupt-after <ms>` sends `fixtures/clips/interrupt.wav` that long after the answer starts; `--loop <s>` alternates the clip with `followup-delivery.wav` for that long, each once the previous answer has played and gone quiet for 8 s (`--url` picks another host). Each session writes `traces/<session-id>.json` (set `TRACE_DIR` to change it); the replay also saves the agent audio beside it as `.agent.wav`.

## Access control and limits (S17)

- **Access code.** `/ws` checks the `code` query parameter against `DEMO_ACCESS_CODE` before
  opening any Bedrock connection. A wrong or missing code gets a `{"type":"rejected","reason":...}`
  frame, then the socket closes with code `4401`.
- **Concurrency.** At most 2 sessions at once (`SessionLimits.maxConcurrent`); a third is closed
  with code `4429` and reason `too many concurrent sessions`.
- **Session cap.** 15 minutes per session. One minute before the cap, and again at the cap, the
  host plays a pre-recorded notice directly on the socket (bypassing Sonic, the same idea as the
  FH-01/03/10 fillers in `phrases/capture.ts`, but not a failure behaviour): captured once with
  `AWS_PROFILE=supplier-dev pnpm --filter host capture-notices` into `assets/notices/`, which the
  host reads at startup. Each notice's `turn` index is negative, so the client's own turn/played
  accounting for the real conversation is untouched.
- **Keepalive.** A WebSocket ping every 20 s, so CloudFront and the ALB don't drop an otherwise
  silent connection.
- **`POST /api/connect/start`.** Checks the same `DEMO_ACCESS_CODE` as `/ws`, sent as `{"code":
...}` in the JSON body rather than a URL query so it doesn't end up in access logs; a wrong or
  missing code is a 401, before `StartWebRTCContact` is ever called. With the right code, calls
  `StartWebRTCContact` against the persistent stack's Connect instance and contact flow (read from
  `CONNECT_INSTANCE_ID` / `CONNECT_CONTACT_FLOW_ID`, set from SSM in AWS) and returns
  `{connectionData, contactId, participantId, participantToken}` for the Connect calling page (S18)
  to join with the Amazon Chime SDK. Returns 503 if those env vars aren't set, 502 if the call
  fails. Not counted toward `/ws`'s 2-concurrent-sessions limit: `StartWebRTCContact` is a single
  request/response with no ongoing connection to this host, so there is nothing for a session count
  to track once it returns.

## Tool calls

Turn detection uses `endpointingSensitivity: LOW`: with `MEDIUM`, Sonic ended the caller's turn in the pause inside a slowly read code and called `get_po_status` with the digits missing (zero-filled) or the last one guessed. The host logs every tool call's input and every caller transcript with the session time, so a wrong code can be traced to what Sonic heard.

Sonic still sometimes calls the tool mid-code, filling the missing digits with zeros or guesses (`sonic/reading.ts`). If the caller has said one to four digits in the current turn, the host holds the lookup until they have said five (at most 4 s), then answers `{"ok":false,"reason":"caller_still_reading"}` without running it, and the model calls again with the whole code. The turn's trace counts these as `early_tool_calls`.

## Playback ledger and barge-in

Each turn's trace records `audio.planned_ms`, `audio.delivered_ms` (audio Sonic generated) and `audio.played_ms` (audio the client reports it played). Over `/ws`:

- Host to client: a `{"type":"turn","index":n}` frame before each turn's first audio, and `{"type":"flush","turn":n}` when Sonic signals `INTERRUPTED` (the interrupted turn may not have sent audio yet).
- Client to host: `{"type":"played","turn":n,"ms":m}` about every 50 ms while playing, and `{"type":"flushed","turn":n,"ms":m}` once it has dropped its queue.

On a barge-in, `bargein.at_ms` is the heard position when Sonic signalled and `audio.flush_latency_ms` is the time until the client confirmed the flush. Planned equals generated unless the turn was interrupted; then it is at least the speculative text's length at 55 ms per character. Sonic generates faster than real time, so heard, not generated, is where a barge-in cuts the answer.

## Session rotation (FH-05)

Sonic closes a connection after 8 minutes, so `sonic/rotator.ts` ports AWS's Python session-continuation pattern. Once a connection is `ROTATE_AFTER_S` old (default 360) and the agent starts speaking (or after 20 s of silence), the host opens the next connection in the background and records caller audio. When the response completes (every speculative text has its final, the text is interrupted, and any tool call's rendering has been spoken), it replays the history into the new connection, using the **heard** agent text from the ledger (an answer built from a tool result is left out, because a new connection copies earlier replies and would speak that PO data again without calling the tool; its system prompt says so and asks for a fresh `get_po_status` call), then the last 3 s of caller audio, makes it current and closes the old one. If the response has not completed 30 s after the next connection opened, it hands over anyway, so the idle next connection cannot time out. The trace records an `FH-05` event with `rotation.gap_ms` (response complete to new connection live) and `rotation.audio_in_ms` / `audio_forwarded_ms` (caller audio received during the transition, and how much reached the old or new connection).

## Failure behaviours (S14)

Three phrases captured by S15 (`assets/phrases/`, voice Matthew, 24 kHz) cover the failures below;
`phrases/fixed.ts` loads variant 1 of each at startup.

- **FH-01, the stream won't open.** If Sonic's bidirectional stream rejects before it opens (a real
  Bedrock failure, or the `fault=fh01` flag below), the host plays the captured fallback phrase
  directly on the socket as a whole turn, traces an `FH-01` event, and closes the session cleanly
  (`session.run()` resolves rather than rejects; no `1011` close).
- **FH-03, a stall.** If no agent audio has started 1.5 s after the caller's last transcript
  segment (`sonic/filler-timer.ts`), including while a tool lookup runs or an early call is held
  (see "Tool calls" above), the host plays the "One moment." filler once for that turn and records
  `filler.played`. The filler is queued on the same turn as any later Sonic audio, which the client
  always plays back to back in the order received (`web/src/softphone/playback-queue.ts`), so it
  finishes before the real answer starts rather than being cut off; this keeps `audio.played_ms` /
  `delivered_ms` consistent, since the filler's bytes count toward the turn's delivered audio too.
- **FH-10, a tool call timeout.** `sonic/tool-timeout.ts` gives `get_po_status` `TOOL_TIMEOUT_MS`
  (3 s) to answer. Past that, the host plays the "Still checking, one moment." filler, traces an
  `FH-10` event, and retries once; whatever the first attempt eventually returns is discarded, even
  if it arrives after the retry started. If the retry also fails to answer in time, the host sends
  a `toolResult` apology (`ok: false`, a `rendering` to speak) instead, so Sonic always answers the
  `toolUse` one way or another.

**Fault flags**, `?fault=fh01|fh03|fh10` on `/ws` (never on by default, documented here only):
forces one of the three behaviours to trigger reliably for the demo video, instead of waiting for a
real stream-open failure or a slow lookup.

- `fh01` swaps in a client whose stream never opens, with no real Bedrock call.
- `fh03` holds the session's first turn's real agent audio back for `FAULT_HOLD_AUDIO_MS` (1.8 s),
  replaying it afterward in order. Delaying the tool call alone isn't reliable: Sonic sometimes
  speaks "Let me check that." well inside the 1.5 s stall window on its own, before the tool call
  even resolves, which used to make the flag a no-op. The hold resets on every caller segment (a
  code read digit by digit spans several), the same way the filler timer's own stall clock does.
- `fh10` makes the session's first `get_po_status` call wait `FAULT_TOOL_DELAY_MS` (4 s), past the
  3 s tool timeout, so the first attempt times out and the (undelayed) retry answers normally,
  giving a believable filler-then-retry-then-answer demo.

Try, e.g.:

```bash
DEMO_ACCESS_CODE=let-me-in pnpm --filter host replay "$PWD/fixtures/clips/po-status-a.wav" PO-10482 \
  --url "ws://127.0.0.1:8080/ws?fault=fh10"   # or fh01 / fh03; --url already carries any query string through to `code`
```

`DEBUG_EVENTS=1` on the host logs every raw Sonic event (name and a truncated body) per session;
useful for diagnosing a live Bedrock quirk without guessing, e.g. the one below.

**A real Sonic gap.** For a long, multi-sentence tool-based reply, Bedrock sometimes never sends a
FINAL confirmation for the trailing sentence's SPECULATIVE text, even though it fully generates and
plays that sentence's audio (its own `contentEnd` even reports `stopReason: END_TURN`). Found live
replaying `po-status-b` (PO-20931, a four-sentence "delayed" rendering) repeatedly with
`DEBUG_EVENTS=1`: the trailing SPECULATIVE text arrives, its audio plays in full, and then nothing
more comes for that segment before Sonic's own `completionEnd` — not a client-side timeout, since
waiting longer doesn't help. `sonic/turns.ts` tracks SPECULATIVE ASSISTANT segments still awaiting
their FINAL per turn; on `completionEnd`, any still pending fall back to their speculative text, so
neither the trace's `assistant.final_text` nor the live transcript is missing what the caller heard.

## Build

`pnpm --filter host build` bundles `src/main.ts` with esbuild into `dist/main.js`, including the workspace `tools` and `traces` sources.
