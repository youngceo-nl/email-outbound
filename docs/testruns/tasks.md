# Task list — work through these in order

Started 2026-08-02, after the first successful test runs.
Full background and evidence: [testrun.md](testrun.md).

Two tracks run in parallel. Claude's track makes the pipeline cheaper and
smarter. The human track raises the speed ceiling. Neither blocks the other.

---

## Do these first — they block everything else

### [ ] H1 · Check the Steel balance — human
**Why first:** if Steel is nearly out of credit, nothing else matters. A
100-lead run is ~45 minutes of browser time; 1000 leads is ~8 hours.

Log in to the Steel dashboard and look at remaining credit. Their API has no
usage endpoint (`/v1/account` and `/v1/usage` both return 421), so this cannot
be automated.

**Done when:** we know the number and whether it covers a 100-lead run.

### [ ] C1 · Build the pre-filter — Claude
**Why first:** biggest win available, no risk, nothing depends on it.

Before Steel opens a profile, fetch it cheaply through Apify (~10s, batched).
If there is no bio link, mark the lead and skip it — it can never qualify, so
spending 28 seconds and AI tokens on it is pure waste.

Seen in the test run: 7 of 20 leads had no bio link.

**Done when:** a run visibly skips no-link leads, the Sourcing/Queued slots show
how many were dropped and why, and tests cover the skip decision.
**Expected:** 1000 leads goes 8h → 5h and $69 → $45.

---

## Next

### [ ] H2 · Buy proxies for the dead Instagram accounts — human
**Why it matters:** this is the real speed ceiling. Everything runs one lead at
a time to stop cookies getting banned. More working accounts is the only safe
way to go faster.

16 accounts exist. **Only 3 work.** The other 13 are missing `proxy_url` and
`steel_profile_id`.

- Group A — 5 accounts, all missing both
- Group B — 5 accounts, all missing both
- Group C — 6 accounts, 3 working, 3 paused/incomplete ← currently active

Buy one proxy per account and keep it pinned. Do not rotate proxies on a
logged-in session — that is what triggers Instagram challenges.

**Done when:** each account you want live has its own stable proxy URL.

### [ ] C2 · Create the Steel profile IDs — Claude, needs H2
Once proxies exist, Claude fills in the matching `steel_profile_id` for each
account and writes both into `app_settings`.

**Unverified:** Claude has not yet confirmed Steel's API allows creating
profiles programmatically. Check this before relying on it — it may turn out to
be a human dashboard task.

**Done when:** the identity pool reports more than 3 usable accounts.

### [ ] C3 · Run 100 leads — Claude, needs C1
Costs about what the 20-lead run did. **20 leads from one seed is not enough to
tune anything against** — this run produces the numbers the remaining decisions
depend on.

**Done when:** the run finishes and we have score, confidence, and challenger
distributions across 100 leads.

---

## After the 100-lead run

### [ ] H3 · Decide what to do about the review pile — human
13 of 20 leads needed a human. That is a product decision, not a bug. Options:

1. Accept the volume and staff the review queue
2. Lower the qualify threshold from 8.0 and accept more false positives
3. Wait for C4 and see if better AI reliability fixes it on its own

Claude should not choose this one.

**Done when:** a decision is written down here.

### [ ] C4 · Fix the AI reliability — Claude, needs C3
The biggest remaining engineering problem, and the root of the other two.

- Confidence came back `low` on 16 of 20 leads. Only one hit `high`.
- The expensive checking model disagreed with the cheap extracting model **5
  times out of 9** — so the cheap one is wrong often.
- 8 of 20 leads could not even have their business model determined.

**Do not turn the expensive model off to save money.** It is catching real
errors at better than a coin flip. Fix the cheap model first, then reconsider.

**Done when:** confidence is no longer `low` on the clear-cut leads, and the
disagreement rate drops.

### [ ] H4 · Top up Apify — human, only if sourcing at volume
Token #1 is over its monthly limit (-$0.04); token #2 has $4.48 left. Rotation
skips the dead one automatically, and sourcing 100 accounts cost $0.00, so this
is not urgent. Only needed for large sourcing runs.

---

## Done

- [x] Pipeline runs end to end without failures — 2 × 20 leads, 0 failed
- [x] Fixed the captcha bug that was discarding readable funnel pages
- [x] Fixed the run summary showing `0 / 20 processed` and `cost unknown`
- [x] Fixed the false "Jammed at Stored" warning on completed runs
- [x] Fixed Apify token rotation so an exhausted token no longer blocks sourcing
- [x] Moved every API key into `app_settings` so the team shares one source
- [x] Added seed sourcing to the test environment page
