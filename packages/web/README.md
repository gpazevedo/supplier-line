# web

Two static pages, built with `pnpm --filter web build`:

- `index.html`: trace viewer. Drop trace JSON files on it.
- `softphone.html`: talks to the host's `/ws`. The mic goes up as 16 kHz PCM; agent audio plays through an AudioWorklet (`src/softphone/playback-worklet.ts`) that reports milliseconds played per turn and flushes on barge-in. Locally, run the host, then `pnpm --filter web dev` and open `/softphone.html`; the dev server proxies `/ws` to `:8080`. Use headphones.
