# YouTube About-page email revealer (headless Chromium + CapSolver)

Reveals the **gated** business email behind the "View email address" button on a
YouTube channel's About page. The free, un-gated path lives in
[lib/youtube/about.ts](../../lib/youtube/about.ts); this is the captcha path.

Core logic is TypeScript so the app can import it:
- [lib/captcha/capsolver.ts](../../lib/captcha/capsolver.ts) — CapSolver reCAPTCHA Enterprise client.
- [lib/youtube/reveal-email.ts](../../lib/youtube/reveal-email.ts) — the Chromium automation.
- `reveal.ts` (this folder) — a CLI/watcher you run with `tsx`.

## Wired into enrichment

The email pipeline ([lib/pipeline/enrich-pipeline.ts](../../lib/pipeline/enrich-pipeline.ts))
runs this reveal **before** AirScale, but only when `CAPSOLVER_API_KEY` and
`YT_GOOGLE_COOKIE` are set. Found emails are stored with
`email_provider: "youtube_about_gated"`.

**Runtime:** real Chromium can't run inside the serverless/Inngest functions.
The step executes only when the pipeline runs locally (`npm run dev`) or on a
worker with Chromium, or against a **remote browser** via `BROWSER_WS_ENDPOINT`
(`chromium.connectOverCDP`). In serverless without that endpoint it logs and
falls through to AirScale.

## Remote browser (run it off your machine — free)

Set `BROWSER_WS_ENDPOINT` and everything (the pipeline, `reveal.ts`) connects to
a hosted Chromium instead of launching locally. Two free routes:

### A. Self-hosted browserless (free, open-source)

Run the free `browserless/chromium` image anywhere that can run Docker — a free
always-on VM works well (e.g. **Oracle Cloud Always Free**, or Railway/Fly/Render):

```bash
docker run -d -p 3000:3000 -e "TOKEN=pick-a-secret" ghcr.io/browserless/chromium
```

Then point the app at it:

```bash
BROWSER_WS_ENDPOINT='ws://YOUR_HOST:3000?token=pick-a-secret'
```

### B. Browserbase free tier (managed, has stealth + proxies)

```bash
BROWSER_WS_ENDPOINT='wss://connect.browserbase.com?apiKey=YOUR_KEY&projectId=YOUR_PROJECT'
```

### Verify it before running the reveal

```bash
BROWSER_WS_ENDPOINT='ws://YOUR_HOST:3000?token=...' npx tsx scripts/youtube/test-remote.ts
# → connected. remote: true | version: ... ; page title: Example Domain ; ✓ remote browser works
```

Once it passes, run `reveal.ts` (or the pipeline) **with no `playwright install`
and no local Chromium** — the browser lives on the remote host. Note: a proxy for
remote mode is configured on the provider, not via `YT_REVEAL_PROXY`.

## Prerequisites

1. **Chromium**: `npx playwright install chromium` (one-time).
2. **CapSolver API key** — reCAPTCHA Enterprise (~$3–4 / 1k solves).
3. **A logged-in Google/YouTube cookie.** The reveal only works signed in. Copy
   the `Cookie` header from a logged-in `youtube.com` request (DevTools →
   Network → any youtube.com request → Request Headers → Cookie). Use a **burner
   account** — this activity gets accounts flagged.
4. **(Recommended) a residential proxy** (`YT_REVEAL_PROXY` / `PROXY_URL`).

## Watch it / run it

```bash
CAPSOLVER_API_KEY=CAP-xxx \
YT_GOOGLE_COOKIE='SID=...; HSID=...; SAPISID=...; __Secure-1PSID=...' \
HEADLESS=false \
npx tsx scripts/youtube/reveal.ts https://www.youtube.com/@SomeChannel
```

`HEADLESS=false` opens a visible Chromium so you can watch the About page load,
the reveal click, the captcha solve, and the email surface. Output is one JSON
line: `{ "email": "...", "businessEmailAvailable": true, "error": null }`.

## Reality check

- Expect **~70%** success even when wired correctly; YouTube re-challenges
  suspicious sessions and changes the flow without notice.
- Two spots will likely need tuning against live YouTube (marked `TUNE:` in
  [reveal-email.ts](../../lib/youtube/reveal-email.ts)): the **reveal-button
  selector** and the **token-injection / confirm** step. Run with
  `HEADLESS=false` and inspect `window.___grecaptcha_cfg` if the email never
  surfaces after a solve.
- This bypasses an anti-harvesting control (YouTube ToS) and touches personal
  data (GDPR/CAN-SPAM) — a deliberate choice, made here at your request.
