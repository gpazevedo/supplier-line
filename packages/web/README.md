# web

Two static pages, built with `pnpm --filter web build`:

- `index.html`: trace viewer. Drop trace JSON files on it.
- `softphone.html`: talks to the host's `/ws`. Enter the demo access code (the host's `DEMO_ACCESS_CODE`) before calling; a wrong or missing code is rejected and the reason appears in the transcript. The mic goes up as 16 kHz PCM; agent audio plays through an AudioWorklet (`src/softphone/playback-worklet.ts`) that reports milliseconds played per turn and flushes on barge-in. Locally, run the host, then `pnpm --filter web dev` and open `/softphone.html`; the dev server proxies `/ws` to `:8080`. Use headphones.

Both pages meet WCAG 2.2 AA. `src/a11y.test.ts` runs an axe-core check against each (in headless Chrome, via Playwright's `channel: 'chrome'`, so no browser download is needed) as part of `pnpm test`.
