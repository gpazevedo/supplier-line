# host

Session host: `GET /health`, and Nova 2 Sonic sessions with `get_po_status` on the `/ws` WebSocket.

## Run locally and replay a clip

```bash
AWS_PROFILE=supplier-dev pnpm --filter host dev            # listens on :8080
pnpm --filter host replay "$PWD/fixtures/clips/po-status-a.wav" PO-10482
```

The replay streams the clip in real time, waits for the answer to finish playing, then prints the transcript beside the expected rendering. Each session writes `traces/<session-id>.json` (set `TRACE_DIR` to change it); the replay also saves the agent audio beside it as `.agent.wav`.

`pnpm --filter host build` bundles `src/main.ts` with esbuild into `dist/main.js`, including the workspace `tools` and `traces` sources.
