# host

Session host: `GET /health`, `POST /api/connect/start`, and Nova 2 Sonic sessions with
`get_po_status` on the `/ws` WebSocket.

## Run locally and replay a clip

```bash
DEMO_ACCESS_CODE=let-me-in AWS_PROFILE=supplier-dev pnpm --filter host dev   # listens on :8080
pnpm --filter host replay "$PWD/fixtures/clips/po-status-a.wav" PO-10482
pnpm --filter host replay "$PWD/fixtures/clips/po-status-a.wav" PO-10482 --interrupt-after 2000
ROTATE_AFTER_S=60 DEMO_ACCESS_CODE=let-me-in AWS_PROFILE=supplier-dev pnpm --filter host dev   # rotate every minute
pnpm --filter host replay "$PWD/fixtures/clips/po-status-a.wav" PO-10482 --loop 180
```

`DEMO_ACCESS_CODE` is required; the host refuses to start without it. `replay` and
`replay-clips` (the caller-clip player) don't need it, but a wrong or missing `code` query
parameter on `/ws` is rejected before any Bedrock call: set `DEMO_ACCESS_CODE` in the environment
and pass it to `runClip`'s `accessCode` option to exercise the real check end to end (see
`replay-clips.ts`).

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
- **`POST /api/connect/start`.** Calls `StartWebRTCContact` against the persistent stack's Connect
  instance and contact flow (read from `CONNECT_INSTANCE_ID` / `CONNECT_CONTACT_FLOW_ID`, set from
  SSM in AWS) and returns `{connectionData, contactId, participantId, participantToken}` for the
  Connect calling page (S18) to join with the Amazon Chime SDK. Returns 503 if those env vars
  aren't set, 502 if the call fails.

## Tool calls

Turn detection uses `endpointingSensitivity: LOW`: with `MEDIUM`, Sonic ended the caller's turn in the pause inside a slowly read code and called `get_po_status` with the digits missing (zero-filled) or the last one guessed. The host logs every tool call's input and every caller transcript with the session time, so a wrong code can be traced to what Sonic heard.

## Playback ledger and barge-in

Each turn's trace records `audio.planned_ms`, `audio.delivered_ms` (audio Sonic generated) and `audio.played_ms` (audio the client reports it played). Over `/ws`:

- Host to client: a `{"type":"turn","index":n}` frame before each turn's first audio, and `{"type":"flush","turn":n}` when Sonic signals `INTERRUPTED` (the interrupted turn may not have sent audio yet).
- Client to host: `{"type":"played","turn":n,"ms":m}` about every 50 ms while playing, and `{"type":"flushed","turn":n,"ms":m}` once it has dropped its queue.

On a barge-in, `bargein.at_ms` is the heard position when Sonic signalled and `audio.flush_latency_ms` is the time until the client confirmed the flush. Planned equals generated unless the turn was interrupted; then it is at least the speculative text's length at 55 ms per character. Sonic generates faster than real time, so heard, not generated, is where a barge-in cuts the answer.

## Session rotation (FH-05)

Sonic closes a connection after 8 minutes, so `sonic/rotator.ts` ports AWS's Python session-continuation pattern. Once a connection is `ROTATE_AFTER_S` old (default 360) and the agent starts speaking (or after 20 s of silence), the host opens the next connection in the background and records caller audio. When the response completes (every speculative text has its final, the text is interrupted, and any tool call's rendering has been spoken), it replays the history into the new connection, using the **heard** agent text from the ledger (an answer built from a tool result is left out, because a new connection copies earlier replies and would speak that PO data again without calling the tool; its system prompt says so and asks for a fresh `get_po_status` call), then the last 3 s of caller audio, makes it current and closes the old one. If the response has not completed 30 s after the next connection opened, it hands over anyway, so the idle next connection cannot time out. The trace records an `FH-05` event with `rotation.gap_ms` (response complete to new connection live) and `rotation.audio_in_ms` / `audio_forwarded_ms` (caller audio received during the transition, and how much reached the old or new connection).

## Build

`pnpm --filter host build` bundles `src/main.ts` with esbuild into `dist/main.js`, including the workspace `tools` and `traces` sources.
