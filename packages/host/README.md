# host

Session host: `GET /health`, and Nova 2 Sonic sessions with `get_po_status` on the `/ws` WebSocket.

## Run locally and replay a clip

```bash
AWS_PROFILE=supplier-dev pnpm --filter host dev            # listens on :8080
pnpm --filter host replay "$PWD/fixtures/clips/po-status-a.wav" PO-10482
pnpm --filter host replay "$PWD/fixtures/clips/po-status-a.wav" PO-10482 --interrupt-after 2000
```

The replay streams the clip in real time, plays the agent audio on a wall clock, waits for the answer to finish playing, then prints the transcript beside the expected rendering. `--interrupt-after <ms>` sends `fixtures/clips/interrupt.wav` that long after the answer starts (`--url` picks another host). Each session writes `traces/<session-id>.json` (set `TRACE_DIR` to change it); the replay also saves the agent audio beside it as `.agent.wav`.

## Playback ledger and barge-in

Each turn's trace records `audio.planned_ms`, `audio.delivered_ms` (audio Sonic generated) and `audio.played_ms` (audio the client reports it played). Over `/ws`:

- Host to client: a `{"type":"turn","index":n}` frame before each turn's first audio, and `{"type":"flush"}` when Sonic signals `INTERRUPTED`.
- Client to host: `{"type":"played","turn":n,"ms":m}` about every 50 ms while playing, and `{"type":"flushed","turn":n,"ms":m}` once it has dropped its queue.

On a barge-in, `bargein.at_ms` is the heard position when Sonic signalled and `audio.flush_latency_ms` is the time until the client confirmed the flush. Planned equals generated unless the turn was interrupted; then it is at least the speculative text's length at 55 ms per character. Sonic generates faster than real time, so heard, not generated, is where a barge-in cuts the answer.

`pnpm --filter host build` bundles `src/main.ts` with esbuild into `dist/main.js`, including the workspace `tools` and `traces` sources.
