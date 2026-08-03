# Task list — work through these in order

Started 2026-08-02, after the first successful test runs.
Full background and evidence: [testrun.md](testrun.md).

Two tracks run in parallel. Claude's track makes the pipeline cheaper and
smarter. The human track raises the speed ceiling.

---

## Now — blocking the 100-lead run

### [x] H5 · New Steel account + new Oxylabs password — 2026-08-03
**Both verified end to end.** A fresh Steel key and a rotated Oxylabs password
were provided; both are now live in `app_settings` and confirmed working —
`@garyvee` captured in 27.4s through the new key and new proxy password, no
challenge, all 5 Story Highlight titles, 5/5 identities usable.

**One thing still unconfirmed: the new Steel account's balance.** Same
limitation as before — the API has no balance endpoint, only per-session
credit usage, and auth succeeding says nothing about how much credit is behind
it. Worth a quick look at the Steel dashboard before committing to a 100-lead
run (~45 min of browser time); a mid-run exhaustion produces a partial,
hard-to-interpret result.

### [ ] C3 · Run 100 leads — Claude, needs H5 balance confirmed
Costs about what the 20-lead run did. **20 leads from one seed is not enough to
tune anything against** — this run produces the numbers the remaining decisions
depend on.

C1 (pre-filter) is done and already wired into this path — see Done.

**Done when:** the run finishes and we have score, confidence, and challenger
distributions across 100 leads.

---

## After the 100-lead run

### [ ] H3 · Decide what to do about the review pile — human
13 of 20 leads needed a human in the last run. That is a product decision, not
a bug. Options:

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

### C1 · Pre-filter — bio-link check before Steel opens a session
Before Steel runs, Apify checks every lead's bio link in batches of 50. No
link → skipped, marked `rejected` / `no_bio_link`, never opens a browser
session. A lead Apify never returns, or a batch that errors, fails open to
Steel — unknown is not the same as absent.

Wired into both `startTestRun` and `startSourcedTestRun` via
`run/prefilter.requested`. Reasoning: seen in the 2026-08-02 runs, 7 of 20
leads had no bio link and not one of them qualified — Steel was spending 28s
and AI tokens per lead to arrive at an answer Apify gives in one batched call.

Verified 2026-08-03: 133/133 tests pass (9 specific to the pre-filter),
typecheck and lint clean, full trigger chain confirmed end to end.

**Provenance note:** this was not built in this conversation's visible thread.
It appeared untracked in the repo, matching the C1 spec and citing this run's
own findings — evidently another session picked up the task from this file.
Read and independently verified rather than taken on trust.

**Expected:** 1000 leads goes 8h → 5h and $69 → $45.

### H1 · Checked the Steel balance
$28 of $30 used, ~$2 left — did not cover a 100-lead run. Established that
Steel is Apache 2.0 and self-hostable via a pre-built Docker image, with the
SDK taking a `baseURL` option — carried forward into H5.

### H2 · Fixed the Instagram proxies — 5 accounts live, up from 3, $0 spent
The proxies were never dead. Oxylabs recreated the proxy user on 2026-08-01
16:11, which made the stored password stale — `407 Unauthorized`, not a
connection failure. A new password fixed all five.

Two things learned and corrected: `dc.oxylabs.io` is a different product this
user cannot access (`disp.oxylabs.io` was correct all along), and ports 8006+
recycle the same five exit IPs — more ports do not mean more identities.

| Account | Port | Exit IP |
|---|---|---|
| `masakonjoku61` | 8001 | 45.155.196.117 |
| `bethannbuczek1` | 8002 | 45.155.196.209 |
| `allinedowho` | 8003 | 45.155.198.110 |
| `jeanettaze` | 8004 | 45.155.197.126 |
| `ilenekawchpw` | 8005 | 45.155.199.56 |

### C2 · Steel profile IDs — resolved, task turned out unnecessary
`steel_profile_id` is now optional; all stored ids cleared. A Steel profile is
an uploaded browser archive scoped to one Steel organisation, not a UUID we
invent — swapping the Steel API key moved us to a new org, which 404'd every
stored id. Sessions do not need one: cookies are injected at session-create
time, verified end to end (`@garyvee` captured in 25.7s, all 5 Story Highlight
titles, no challenge). Requiring it had disqualified 13 of 16 accounts for no
benefit.

### Other fixes
- Pipeline runs end to end without failures — 2 × 20 leads, 0 failed
- Fixed the captcha bug that was discarding readable funnel pages
- Fixed the run summary showing `0 / 20 processed` and `cost unknown`
- Fixed the false "Jammed at Stored" warning on completed runs
- Fixed Apify token rotation so an exhausted token no longer blocks sourcing
- Moved every API key into `app_settings` so the team shares one source
- Added seed sourcing to the test environment page
