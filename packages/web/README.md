# web

Three static pages, built with `pnpm --filter web build`:

- `index.html`: trace viewer. Drop trace JSON files on it.
- `softphone.html`: talks to the host's `/ws`. Enter the demo access code (the host's `DEMO_ACCESS_CODE`) before calling; a wrong or missing code is rejected and the reason appears in the transcript. The mic goes up as 16 kHz PCM; agent audio plays through an AudioWorklet (`src/softphone/playback-worklet.ts`) that reports milliseconds played per turn and flushes on barge-in. Locally, run the host, then `pnpm --filter web dev` and open `/softphone.html`; the dev server proxies `/ws` to `:8080`. Use headphones.
- `connect.html`: calls `POST /api/connect/start` (S17) and joins the returned Amazon Connect WebRTC contact with the [Amazon Chime SDK for JavaScript](https://github.com/aws/amazon-chime-sdk-js) (`src/connect/`). Enter the demo access code (the host's `DEMO_ACCESS_CODE`) before calling, same as the softphone; a wrong or missing code is rejected and the reason appears in the call log. Locally, run the host with `CONNECT_INSTANCE_ID` and `CONNECT_CONTACT_FLOW_ID` set (see `packages/host/README.md`), then `pnpm --filter web dev` and open `/connect.html`; the dev server proxies `/api` to `:8080` alongside `/ws`. Use headphones.

## Connect calling page (S18)

`src/connect/api.ts` sends the access code in `/api/connect/start`'s JSON body (not a URL query, so it doesn't end up in logs) and parses the response; `src/connect/meeting.ts` builds the Chime `DefaultMeetingSession` from the returned `connectionData` (`{Meeting, Attendee}`, as `StartWebRTCContact` returns them); `src/connect/status.ts` turns a Chime session's end status into the line shown in the call log; `src/connect/main.ts` wires these to the DOM (an access-code field styled like the softphone's, a `role="status"` region and an `aria-live="polite"` call log). `window.__buildMeetingSession`, if set before the page loads, replaces the real Chime SDK call — `a11y.test.ts` uses it to reach an in-call and a call-ended-on-failure state without real WebRTC signalling or a microphone.

Amazon Connect doesn't expose a transcript to the browser on this path (unlike `/ws`), so the call log only shows lifecycle events (calling, connected, ended and why), not what was said.

### Manual verification (needs a human with a mic and speakers)

1. `AWS_PROFILE=supplier-dev` with `DEMO_ACCESS_CODE`, `CONNECT_INSTANCE_ID` and `CONNECT_CONTACT_FLOW_ID` set, run `pnpm --filter host dev`, then `pnpm --filter web dev` and open `/connect.html`.
2. Enter the same `DEMO_ACCESS_CODE` in the Access code field, click **Call**, wait for "On a call", and ask for the status of one of the PO codes in `fixtures/clips/README.md` (for example "P O one zero four eight two"). Confirm the bot speaks a correct status, amount and date, matching `packages/tools/src/data`.
3. Click **Hang up**; the status should read "Call ended."
4. **To trigger the flow's error branch** (`packages/infra/src/persistent/contact-flow.ts`): call again and then say nothing at all after the greeting. The `ConnectParticipantWithLexBot` block's `InputTimeLimitExceeded` error routes to the message block, which speaks `ERROR_MESSAGE` ("Sorry, something went wrong on our side. Please try again later. Goodbye.") before disconnecting. This is the safe trigger — it needs no malformed input or service fault, only silence.

## Accessibility

All three pages meet WCAG 2.2 AA. `src/a11y.test.ts` runs an axe-core check against each (in headless Chrome, via Playwright's `channel: 'chrome'`, so no browser download is needed) as part of `pnpm test`.
