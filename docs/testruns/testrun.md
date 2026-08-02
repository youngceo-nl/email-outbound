# Test run report — 2026-08-02

**Working checklist: [tasks.md](tasks.md)** — this file is the evidence behind it.

Two runs of 20 real leads, sourced from seed `@kishanslings`.
**Both completed. Nothing crashed.**

Before today the pipeline was broken: the previous batch failed on 552 leads and
wrote all-zero scores that were indistinguishable from genuinely weak profiles.

| Run | Link |
|---|---|
| Run 1 — before the fix | `/test-environment/7b9b7b08-8777-4a74-af89-921b9a9b7a03` |
| Run 2 — after the fix | `/test-environment/7192fcdc-455b-4316-8d03-062152139668` |

---

## Numbers

| | Run 1 | Run 2 |
|---|---|---|
| Processed | 19/20 | **20/20** |
| Qualified / Review / Rejected / Data retry | 4 / 12 / 1 / 2 | 4 / 13 / 1 / 2 |
| Failed | 0 | 0 |
| Expensive AI fired | 53% | 45% |
| Cost | $1.57 ($0.083/lead) | **$1.38 ($0.069/lead)** |
| Median time per lead | 34.8s | **27.9s** |

**Roughly 7 cents and 28 seconds per lead. 1000 leads ≈ 8 hours and ~$69.**

---

## What was fixed today

### The captcha bug — was throwing away our best evidence

When a bio link pointed at a page using Google's spam protection (stan.store,
checkout pages, signup forms — very common for this audience), the system found
the word `captcha` inside `recaptcha/enterprise.js` and assumed the page was
blocking us. It threw the page away and fell back to an empty one.

The AI was then told "we found nothing" about pages we had read perfectly well.

After the fix:

| Lead | Score |
|---|---|
| `@_lillisophia_` | 2.5 → **6.75** |
| `@austingeorgas` | 3.25 → **5.75** |
| `@briarcochran` | 3.25 → **5.75** |
| `@bigbrahhh` | 5.7 → **7.0** |
| `@allday.fba` | confidence medium → **high** |
| `@bensimpsonau` | review → **qualified** |

Note: this did **not** shrink the review pile (12 → 13). Better evidence moved
leads *up into* the review band, not through it. Fixing evidence is not the lever
that empties the queue — see problem 2 below.

### Two things that were lying to us

- The run summary showed `0 / 20 processed` and `cost unknown` on runs that
  worked fine. Those counters were never written by the pipeline; the page now
  calculates them from the individual lead rows instead.
- The page announced **"Jammed at Stored"** on runs that had finished perfectly.
  A finished lead sits in the last slot forever, so the stall check now ignores
  that slot.

---

## Three problems that remain

### 1. A third of leads are a waste of time
**7 of 20 profiles have no bio link at all.** They can never qualify — there is
nothing to evaluate. The system still spends 28 seconds and AI tokens on each.

### 2. The AI is unsure about almost everything
Confidence was `low` on **16 of 20** leads. Only one hit `high`. This — not the
scores — is what pushes leads into manual review. 8 of 20 could not even have
their business model determined.

### 3. The two AIs disagree half the time
A cheap model extracts, an expensive one double-checks. **The expensive one
disagreed 5 times out of 9.** That means the cheap one is often wrong.

**Do not turn the expensive model off to save money.** It is catching real
errors at better than a coin flip. Fix the cheap one first.

---

## What to do — Claude

### [ ] 1. Build the pre-filter
Check each profile cheaply (Apify, ~10s, batch) before Steel runs. No bio link →
skip it. Don't spend 28 seconds on a lead that cannot qualify.

**1000 leads: 8 hours → 5 hours, $69 → $45.** No downside, no added risk.

### [ ] 2. Run 100 leads — after the pre-filter lands
A 100-lead run costs about what today's 20-lead run did. **20 leads from a single
seed is not enough to tune thresholds against.** Claude can start and watch this
one the same way as today's runs.

### [ ] 3. Fix the AI reliability — later, but it's the big one
Behind all three problems: low confidence, the review pile, and the expensive
model firing so often. Needs the 100-lead data first.

### [ ] 4. Create the Steel profile IDs — only if proxies are supplied
If the proxies from the human list below arrive, Claude can likely create the
matching `steel_profile_id` values through the Steel API and write them into
`app_settings`. Unverified — needs checking before it is promised.

---

## What to do — human

These need an account, a card, or a dashboard login. Claude cannot do them.

### [ ] 1. Buy/assign proxies for the 13 dead Instagram accounts
16 accounts exist, **only 3 work.** The rest are missing `proxy_url` and
`steel_profile_id`.

This is the real ceiling on speed. Everything runs one-at-a-time to avoid getting
cookies banned; more working accounts is the only safe way to go faster.

- Group A (5 accounts) — all missing proxy + steel profile
- Group B (5 accounts) — all missing proxy + steel profile
- Group C (6 accounts) — 3 working, 3 paused/incomplete ← currently active

One pinned proxy per account, kept stable. Rotating proxies on a logged-in
session is what gets accounts challenged.

### [ ] 2. Check the Steel balance
Steel's API has no usage endpoint (`/v1/account` and `/v1/usage` both return
421), so this has to be read off the Steel dashboard. 1000 leads is roughly 8
hours of browser time, which is not trivial on most plans.

### [ ] 3. Top up Apify — only if sourcing at volume
Token #1 is over its monthly limit (-$0.04); token #2 has $4.48. Fine for tests.
Sourcing itself is nearly free, so this is not urgent.

### [ ] 4. Decide on the review pile
13 of 20 leads land in manual review. That is a product decision, not a bug:
either accept the volume, loosen the qualify threshold, or wait for the AI
reliability work. Claude should not pick this.

---

## Not blocking, worth knowing

- `learn.alldayfba.com` returns zero readable text even through ScrapingBee.
  Genuinely unreadable, not a bug — affects few leads.
- `collectiveshift.net/hnw-or` is a dead bio link ("page not found"). A real
  finding about that lead, not a system fault.
- Apify sourcing is effectively free — pulling 100 accounts moved the balance
  $0.00. Apify credit is not a constraint on getting leads in.
- Apify token #1 is over its monthly limit (-$0.04). Token rotation now skips it
  automatically; token #2 has $4.48 left.
- All API keys now live in `app_settings`, not `.env.local`. Add new ones with
  `echo -n "<key>" | npx tsx scripts/set-api-key.mts <column>` — see CLAUDE.md.
