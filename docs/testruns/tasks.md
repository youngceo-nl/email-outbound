# Task list — work through these in order

Started 2026-08-02, after the first successful test runs.
Full background and evidence: [testrun.md](testrun.md).

Two tracks run in parallel. Claude's track makes the pipeline cheaper and
smarter. The human track raises the speed ceiling.

---

## Open

### [ ] C3 · Finish the 100-lead run — Claude
Paused at 13/77 acquired on 2026-08-03 when the self-hosted Steel container
crashed mid-run (see Done — cause found and fixed). Verified safe to continue:
fresh container + a 6-lead batch afterward, all captured cleanly, no failures,
no timeouts, memory reclaimed properly between sessions.

**Not yet proven:** the original crash only appeared after ~13 sequential
sessions; the post-fix verification only reached 6-7. Real confidence needs
either finishing this run or a longer soak test.

**Done when:** the run finishes and we have score, confidence, and challenger
distributions across 100 leads.

### [ ] H3 · Decide what to do about the review pile — human
13 of 20 leads needed a human in the 2026-08-02 run. That is a product
decision, not a bug. Options:

1. Accept the volume and staff the review queue
2. Lower the qualify threshold from 8.0 and accept more false positives
3. Wait for C4 and see if better AI reliability fixes it on its own

Claude should not choose this one.

**Done when:** a decision is written down here.

### [ ] C4 · Fix the AI reliability — Claude, needs C3
**The biggest piece of unfinished work** — nothing here has been touched yet;
2026-08-03 was entirely infrastructure (Steel self-hosting, the crash, the
fix). This is what actually determines whether the pipeline judges leads well.

- Confidence came back `low` on 16 of 20 leads. Only one hit `high`.
- The expensive checking model disagreed with the cheap extracting model **5
  times out of 9** — so the cheap one is wrong often.
- 8 of 20 leads could not even have their business model determined.

**Do not turn the expensive model off to save money.** It is catching real
errors at better than a coin flip. Fix the cheap model first, then reconsider.

**Done when:** confidence is no longer `low` on the clear-cut leads, and the
disagreement rate drops.

---

## Not urgent

### [ ] H4 · Top up Apify — human, only if sourcing at volume
Token #1 is over its monthly limit (-$0.04); token #2 has $4.48 left. Rotation
skips the dead one automatically, and sourcing 100 accounts cost $0.00, so this
is not urgent. Only needed for large sourcing runs.

### [ ] H6 · Buy proxies for groups A and B — human, only to go past 5
10 accounts in groups A and B already have cookies and need only a proxy each.
The current Oxylabs plan is exhausted at 5 distinct IPs.

Not urgent: **concurrency is still pinned at 1**, so 5 identities are already
more than the pipeline uses. Only worth doing once concurrency is raised.

---

## Done

- **Pipeline runs end to end** — 2 × 20 leads on 2026-08-02, 0 failed
- **Captcha bug fixed** — was discarding readable funnel pages (recaptcha
  script tag false-matched as a bot wall)
- **Run summary fixed** — was showing `0 / 20 processed`, `cost unknown` on
  runs that worked
- **False "Jammed at Stored" warning fixed** on completed runs
- **Apify token rotation fixed** — an exhausted token no longer blocks sourcing
- **All API keys moved into `app_settings`** — shared across the team, not
  per-laptop `.env.local`
- **Seed sourcing added** to the test environment page
- **C1 · Pre-filter** — Apify checks every lead's bio link before Steel opens a
  session; no link → skipped, never spends a browser session. 7 of 20 leads in
  the 2026-08-02 run had no bio link and none qualified. Expected: 1000 leads
  8h → 5h, $69 → $45. 133/133 tests pass.
- **H1 · Steel balance checked** — $28/$30 used, ~$2 left, didn't cover a
  100-lead run. Confirmed Steel is Apache 2.0 and self-hostable.
- **H2 · Instagram proxies fixed** — 5 accounts live (up from 3), $0 spent. The
  proxies were never dead; Oxylabs had rotated the account password. Also
  corrected: `dc.oxylabs.io` is the wrong product, `disp.oxylabs.io` is
  correct; ports beyond 8005 just recycle the same 5 exit IPs.
- **C2 · Steel profile IDs made optional** — turned out unnecessary. A Steel
  profile is an uploaded archive scoped to one Steel org, not something we
  invent; sessions work fine without one. Requiring it had disqualified 13 of
  16 accounts for no benefit.
- **H5 · Steel self-hosted** — $0 instead of Steel Cloud's ~40-lead ceiling on
  $30. Runs locally via Docker/Colima, `steel_base_url` in `app_settings`
  switches to it. Caught and fixed a real bug in the process: self-hosted
  sessions logged "Proxy source: none (direct)" because Steel Cloud's
  `proxySource` field doesn't exist on the self-hosted API — verified the
  proxy was genuinely working (browser's real exit IP matched the pinned
  Oxylabs IP, not this machine's) and fixed the log to stop reporting it as a
  leak.
- **Concurrency incident diagnosed and fixed (2026-08-03)** — C3 briefly
  showed 43 leads "acquiring" at once and the Steel container crashed. Proved
  with direct tests that Inngest's `concurrency: {limit: 1}` was never the
  problem (a 20-event burst and a 90-second single-step hold both serialized
  correctly). The real cause, read from the server log: real acquisition
  durations climbed 10s → 16s → 43s → 57s → 63s across sequential sessions as
  the container degraded, then every attempt after that failed in under 2s —
  fast failures that looked like parallelism in the database timestamps.
  Fixed by bounding a single acquisition to 90s (`withTimeout`, 8 new tests);
  a timeout is handled as its own path and does **not** quarantine the
  account, since it's evidence about the browser backend, not that identity.
  Verified post-fix: fresh container restart, 6 real leads captured cleanly,
  durations varied 11–59s with no climb, memory reclaimed properly.
