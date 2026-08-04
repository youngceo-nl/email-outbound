# Task list

Started 2026-08-02, after the first successful test runs.
Full background and evidence: [testrun.md](testrun.md).

---

# 🔴 BLOCKING RIGHT NOW — nothing can run until this is done

The pipeline points at the self-hosted Steel server
(`https://steel-api.paidinfunnel.com`), which sits behind **Cloudflare Access**.
Access answers **403 to every request** regardless of Steel's own API key —
verified against no-auth, `steel-api-key`, and `Bearer`. **A run started today
fails on every single lead.**

Migration `20260806000000` is applied and the code is ready. Only the token is
missing.

## 👤 YOU

### [ ] Create a Cloudflare Access service token
Cloudflare renamed **Access** to **Access controls** — the paths below are the
current ones, checked against Cloudflare's own docs on 2026-08-05.

1. **Zero Trust → Access controls → Service credentials → Service Tokens →
   Create Service Token.** Name it something like `email-outbound-pipeline`.
2. Copy **both** values. The **Client Secret is shown only once.**
   - Client ID looks like `<long-string>.access`
   - Client Secret is a long random string
3. Attach it to the app, or the token exists and is still rejected:
   **Zero Trust → Access controls → Applications →** the `steel-api` app **→
   Policies → Add policy**, action **Service Auth** — not the default identity
   action, or Cloudflare still demands a browser login and the token is
   rejected. Include **Service Token → the one you just created**.
4. Paste both values into the chat.

**Done when:** a probe of `/v1/sessions` returns 200 instead of 403.

## 🤖 CLAUDE

### [ ] Store the token and verify the connection
Writes both values to `app_settings` (not `.env.local` — see CLAUDE.md), then
re-probes and runs **one** real acquisition end to end before touching the 667
waiting leads. Blocked on your step above.

### [ ] Then: fresh run to re-measure C4
The certainty deadlock is fixed and replay-verified, but **no run has ever
executed under the new logic** — the 64 → 14 result comes from replaying stored
C3 decisions, not from live scoring. A fresh run also re-measures the challenger
fire rate, which was 18% on C3 versus 45–65% on the 2026-08-02 runs and has
never been reconciled.

**Done when:** a fresh run's review rate and challenger rate are recorded here.

---

## Open — not blocking

### [ ] H7 · Seed selection — the yield problem — 👤 YOU
**Probably a bigger lever on revenue than any pipeline fix.** Of the 75 leads
C3 scored, **44 were streetwear/clothing brands** (track `commerce`) and only
**9 were `information_personal_brand`** — the actual ICP. `@kishanslings`
follows clothing brands, not infopreneurs.

C4 makes the pipeline correctly *reject* those 44 instead of queueing them for
a human, which is the right behaviour — but it does not create good leads. On
this seed the usable yield is roughly **4–5 per 75 (~6%)**, and no amount of
scoring work changes that.

Worth reviewing which seed accounts actually follow the people we want before
running volume. A seed whose following is 60% off-ICP burns ~60% of the Steel
time and Anthropic spend on leads that were never going to qualify.

**Done when:** a shortlist of seeds whose following skews to the ICP is agreed.

---

## Not urgent

### [ ] H4 · Top up Apify — 👤 YOU, only if sourcing at volume
Token #1 is over its monthly limit (-$0.04); token #2 has $4.48 left. Rotation
skips the dead one automatically, and sourcing 100 accounts cost $0.00, so this
is not urgent. Only needed for large sourcing runs.

### [ ] H6 · Buy proxies for groups A and B — 👤 YOU, only to go past 5
10 accounts in groups A and B already have cookies and need only a proxy each.
The current Oxylabs plan is exhausted at 5 distinct IPs.

Not urgent: **concurrency is still pinned at 1**, so 5 identities are already
more than the pipeline uses. Only worth doing once concurrency is raised.

---

## Done

- **H3 · Review-pile decision — option 3: improve the system until it works.**
  Not staffing the queue, not lowering the threshold. Directly motivated C4.

- **C4 · Certainty deadlock fixed (2026-08-03)** — the 83% review rate was not
  model doubt, it was a logic deadlock. `decide.ts` gated every auto-reject
  behind `certainty === "high"`, and `high` was unreachable: **0 of 75 C3 leads
  reached it.** Two independent causes in `certainty.ts` — a challenger that had
  not run blocked `high` unconditionally (it runs on a minority of leads), and
  `conflicts > 0` forced `low` even though that is the very condition that
  summons the challenger, so all 14 challenged leads came back `low` including
  the 4 it agreed with. Its verdict was inert.

  Fix: a separate `deriveRejectionConfidence` asking only "did we actually SEE
  this" (profile captured, no `unknown` core signal, business model determined,
  data reliable, challenger not disputing). Auto-**approval** still requires
  `high` — that path is untouched, because the risk is asymmetric.

  **Verified by replaying all 75 stored C3 decisions through the new logic at
  zero API cost** (`decideCommercialQualification` is pure and the snapshots are
  stored): **50 leads flip review → rejected, 0 in-ICP leads wrongly rejected,
  review pile 64 → 14.** The 14 remaining are the 4 genuine review-band
  information_personal_brand leads plus 10 correctly held back by the safety
  valve (undetermined business model, unseen core signal, or a challenger
  actively disputing the extraction).

  The replay also caught a real gap mid-implementation: one lead was being
  auto-rejected on an extraction the challenger had explicitly **disagreed**
  with. Acting on a disputed reading is unsafe in either direction, so that now
  blocks auto-rejection too.

  140 tests pass (7 new C4 regressions); typecheck and lint clean.

- **C3 · 100-lead run finished (2026-08-03)** — sourced 100, prefilter skipped
  23 (no bio link), 77 went through Steel. **77/77 processed, only 2 failures**
  (both genuine Instagram checkpoints on one account, correctly quarantined,
  not the crash from earlier). 5 qualified, 64 review, 5 rejected, 1 data
  retry. Challenger fired 14/77 (18%). Cost $3.79 ($0.049/lead). Median 21.4s
  per lead. Container held steady the whole way — memory oscillated 358MB–965MB
  throughout, never trended toward the cap, confirming the timeout fix
  resolved the crash risk (see the concurrency-incident entry below).

  Caught and fixed a second, smaller issue mid-run: 3 leads sat stuck at
  `qualification_queued` for up to 20 minutes — their triggering event for the
  qualify step was dropped somewhere between acquisition finishing and
  qualify-lead picking it up. Not data loss (their evidence snapshots existed
  fine); resending the event for those 3 specifically unstuck them immediately.
  Root cause not yet investigated — worth a look if it recurs.

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
