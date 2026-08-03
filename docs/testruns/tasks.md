# Task list — work through these in order

Started 2026-08-02, after the first successful test runs.
Full background and evidence: [testrun.md](testrun.md).

Two tracks run in parallel. Claude's track makes the pipeline cheaper and
smarter. The human track raises the speed ceiling. Neither blocks the other.

---

## Do these first — they block everything else

### [x] H1 · Check the Steel balance — human
**Answer: $28 of $30 used. About $2 left.**

That does not cover a 100-lead run (~45 minutes of browser time), so **C3 is
blocked** until this is resolved.

**Steel is open source and self-hostable — Apache 2.0.** The pre-built Docker
image runs a full instance, and the SDK takes a `baseURL` option, so pointing at
our own instance is a config change rather than a rewrite. Self-hosting makes
Steel itself free; the cost moves to whatever server it runs on.

Two ways forward — see H5.

### [x] C1 · Build the pre-filter — Claude
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

### [x] H2 · Get proxies for the Instagram accounts — human · DONE 2026-08-03
**Result: 5 accounts live, up from 3. No money spent.**

The proxies were never dead. Oxylabs recreated the proxy user on **2026-08-01
16:11**, which made the password stored in `app_settings` stale — the endpoint
was returning `407 Unauthorized`, not a connection failure. A new password fixed
every one of them.

Two earlier claims in this task were wrong and are corrected below:

- `dc.oxylabs.io` is a **different product** this user cannot access.
  `disp.oxylabs.io` was correct all along.
- Ports 8006+ **recycle the same five exit IPs**. More ports do not mean more
  identities, so "8004–8016 may already be yours" was only half right — they are
  yours, but there are only five distinct addresses behind them.

Now live, one pinned proxy each, all unpaused:

| Account | Port | Exit IP |
|---|---|---|
| `masakonjoku61` | 8001 | 45.155.196.117 |
| `bethannbuczek1` | 8002 | 45.155.196.209 |
| `allinedowho` | 8003 | 45.155.198.110 |
| `jeanettaze` | 8004 | 45.155.197.126 |
| `ilenekawchpw` | 8005 | 45.155.199.56 |

**Still open:** groups A and B (10 accounts, all with cookies) have no proxies,
and this plan has no spare IPs. Going beyond 5 identities means buying more —
see H6.

### [x] C2 · Steel profile IDs — Claude · RESOLVED, not needed
**This task no longer exists.** `steel_profile_id` is now optional and all
stored ids have been cleared.

The earlier note here was wrong: a Steel profile is **not** a UUID we invent.
It is an uploaded browser archive scoped to one Steel organisation — Steel 404s
on unknown ids, and creating one needs a multipart upload. Swapping the Steel
API key moved us to a new organisation, which invalidated every stored id.

Sessions do not need one. Cookies are injected at session-create time, verified
end to end on 2026-08-03 (`@garyvee` captured in 25.7s, all 5 Story Highlight
titles, no challenge). Requiring it had been disqualifying 13 of 16 accounts for
no benefit.

### [ ] H6 · Buy proxies for groups A and B — human, only to go past 5
10 accounts in groups A and B already have cookies and need only a proxy each.
The current Oxylabs plan is exhausted at 5 distinct IPs.

Not urgent: **concurrency is still pinned at 1**, so 5 identities are already
more than the pipeline uses. Only worth doing once concurrency is raised.

### [ ] C3 · Run 100 leads — Claude, needs C1 **and H5 (Steel credit)**
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

### [ ] H5 · Decide: top up Steel Cloud, or self-host — human
Blocking C3. Steel is at $28/$30.

1. **Top up Steel Cloud** — instant, keeps everything working as-is, ongoing cost
2. **Self-host** (Apache 2.0, Docker image) — Steel becomes free, but you run the
   browser infrastructure and pay for the server. Proxies still cost either way.

Claude can do the wiring for option 2 (it is a `baseURL` change plus deployment);
the call on whether to run that infrastructure is yours.

**Done when:** a decision is written here and C3 is unblocked.

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
