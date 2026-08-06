# Pipeline KPIs — definitions, baselines, and what moves them

Measured 2026-08-06 from the three real runs on record (2026-08-03 "C3", 2026-08-04 "C4",
2026-08-05). Everything here comes from `qualification_runs`, `qualification_run_leads`,
`lead_qualification_decisions` and `crawl_logs` — the queries are at the bottom so any
number can be re-derived rather than trusted.

---

## The three KPIs

| # | KPI | Target | Current | Measurable today? |
|---|-----|--------|---------|-------------------|
| 1 | Leads sent to manual review | **≤ 5%** | **62%** | Yes |
| 2 | Scored leads scored *correctly* | (implicitly ~100%) | **unknown** | **No — see below** |
| 3 | AI cost | per qualified lead | **$0.33 – $0.76** | Yes, but not by the app |

These interact, and the interaction is the whole game. Driving review from 62% to 5% is
trivial on its own — auto-decide everything. It is only an improvement if the leads that
*stop* going to review get decided correctly, which is KPI 2. **KPI 1 cannot be
optimised without KPI 2, and KPI 2 is not currently measurable.** That is the single
biggest gap in this list.

---

## KPI 1 — Review rate

**Target ≤ 5%. Current 62%** (108 of 174 decisions, 2026-08-02 onward).

Per run: C3 86%, C4 23%, 08-05 43%. The swing is real, not noise — see "the dominant
variable" below.

> **Do not compute this over all history.** 426 decisions on 2026-08-01 were 100% review,
> every one of them `ai_output_invalid` — a single broken extraction batch. It is fixed
> (zero occurrences from 08-02 onward) but it swamps any all-time average and makes
> extraction look like the dominant cause when it no longer is. Always filter
> `created_at >= '2026-08-02'`.

### Why leads go to review, ranked (08-02 onward, 108 reviewed leads)

| `decision_reasons` | count | share | cumulative |
|---|---|---|---|
| `missing_core_evidence` | 65 | 60% | 60% |
| `core_signal_unknown` | 18 | 17% | 77% |
| `information_personal_brand` | 15 | 14% | 91% |
| `score_in_review_band` | 14 | 13% | 104% |
| `agency_information_mixed` | 6 | 6% | 109% |
| `uncertain_track`, `excluded_track`, `score_below_threshold` | 5 | 5% | — |

(Exceeds 100% because a lead can carry several reasons.)

**`missing_core_evidence` at 60% is the whole ballgame.** It is not a scoring-logic
problem — it means the pipeline did not gather enough evidence to decide. Getting to 5%
is mostly an *acquisition and evidence* problem, not a *classifier tuning* problem.
Tuning decision thresholds addresses at most the bottom 30% of this table.

Certainty on reviewed leads: `low` 45, `medium` 61, `high` 2 — consistent with
"insufficient evidence" rather than "genuinely ambiguous business".

### Already fixed (2026-08-06)

`agency_information_mixed` fired whenever reliable agency evidence existed and the
primary outcome was not done-for-you — **including when the outcome was positively
identified as `coaching`**. It was keying off the extractor's confidence label rather
than the business: `@adrixnk` auto-qualified with **10** cited agency-evidence items
because reliability came back `incomplete`, while `@drcleoamelia` went to review on
**5** because it came back `reliable`. Now only non-information outcomes go to review.
See ADR in git history and `lib/qualification/eligibility.ts`.

---

## KPI 2 — Scoring accuracy

**Not measurable today.** There is no labelled set, so there is no denominator.

The only ground truth that exists: three leads reviewed by hand on 2026-08-05
(`drcleoamelia`, `alisha_conlin_hurd`, `diazzz_`). All three were sent to manual review
by the scorer. All three were judged **qualified** by the user. On the only labelled
sample we have, **the scorer was wrong 3 out of 3** — always in the same direction
(too conservative, routing ICP leads to review).

Three leads is not a measurement. It is a signal worth acting on and nothing more.

### What accuracy actually requires

A labelled evaluation set: 30–50 decided leads, each labelled qualified/rejected by a
human, stored so it can be re-run against every scorer change. Without it:

- "Accuracy" is an opinion, not a number.
- Any change to the review threshold is a blind trade — you cannot tell whether cutting
  review from 62% to 5% converted correct reviews into correct auto-decisions or into
  silent false negatives.
- Regressions are invisible. The scorer can get worse and every dashboard stays green.

**This is the prerequisite for KPI 1.** Build the labelled set first.

### The qualification criteria to label against

From the user, 2026-08-05:

- **Selling an info offer qualifies** — community, 1:1 coaching, course. Ticket size does
  not decide it; low-ticket community or a cheap course still qualifies.
- **Read the funnel to tell high vs low ticket.** If the prospect's next step is *booking
  a call*, it is almost always high ticket.
- **Client-results highlights showing students** are a positive signal.
- **The bigger the promised transformation, the more likely high-ticket.**
- **Serving agency owners ≠ being an agency.** A lead helping agency owners hit
  $100k+/month is an info offer *aimed at* agency owners — ICP, not a done-for-you
  agency. Ask what they **sell**, not who they serve.

---

## KPI 3 — AI cost

`estimated_cost_usd` in `qualification_run_leads` is **0 on every row** — the app never
computes it. The numbers below are derived from the recorded token counts at published
rates: Haiku 4.5 $1/$5 per MTok (extractor), Opus 5 $5/$25 per MTok (challenger).

| run | decided | qualified | extraction | challenger | total | $/decided | **$/qualified** |
|---|---|---|---|---|---|---|---|
| 08-03 C3 | 75 | 5 | $2.26 | $1.52 | $3.79 | $0.051 | **$0.76** |
| 08-04 C4 | 39 | **0** | $1.19 | $0.54 | $1.73 | $0.044 | **∞** |
| 08-05 | 13 | 5 | $0.51 | $1.13 | $1.64 | $0.126 | **$0.33** |

**$/qualified lead is the only cost number that means anything.** $/decided lead flatters
the worst run: C4 has the *best* cost per decided lead ($0.044) and produced **zero**
qualified leads — $1.73 spent for nothing. Optimising $/decided actively rewards
processing cheap junk.

### The cost driver is the challenger

On the 08-05 run the Opus 5 challenger was **69% of total cost** ($1.13 of $1.64) while
running on only 45% of leads. It is ~5x the extractor's per-token price. Challenger fire
rate by run: C3 14%, C4 10%, 08-05 45%.

That makes challenger rate the main cost lever — but do not cut it before KPI 2 is
measurable. The challenger exists to catch extraction errors; turning it down without a
labelled set trades an unknown amount of accuracy for a known amount of money.

---

## The dominant variable: seed quality

Bigger than every KPI above, and independent of the pipeline.

| run | seed (source account) | ICP track rate | qualified / requested |
|---|---|---|---|
| 08-03 C3 | `@mannyfrometa` (90/100) | 12% | 5 / 100 |
| 08-04 C4 | `@mannyfrometa` (41/50) | 13% | **0 / 50** |
| 08-05 | **`@iamjadenly`** (18/20) | **62%** | 5 / 20 |

Combined: `@mannyfrometa` returned **5 qualified from 150 requested (3.3%)**.
`@iamjadenly` returned **5 from 20 (25%)**. **A 7.5x difference in yield, from the seed
alone** — same pipeline, same scorer, same accounts.

Every lead costs the same to process regardless of whether it can ever qualify: a Steel
session, an Apify call, a Haiku extraction, sometimes an Opus challenger. Seeding from an
account whose following list is not ICP is paying full price for guaranteed rejections.
C4 is the clean demonstration: 50 leads, full cost, zero qualified.

**Recommended process change:** before committing a full batch to a new seed, run 20
leads and check the ICP track rate. Commit only above ~30%. This turns a 50-lead wasted
run into a 20-lead test, and the metric to gate on already exists — it is just not being
used as a gate.

Caveat: `@iamjadenly` is 13 decided leads. The signal is strong and consistent with the
track data, but it is not yet proven at 100-lead scale.

---

## Known measurement gaps

1. **No labelled set** → KPI 2 unmeasurable, KPI 1 un-optimisable. *Highest priority.*
2. **`qualification_runs` counters never update.** Every run — including completed ones —
   reads `status: running` with all counters at 0. Per-lead data in
   `qualification_run_leads` is correct; only the rollup is broken. This is why run
   results have to be reconstructed by hand.
3. **`estimated_cost_usd` is always 0.** Cost has to be recomputed from tokens every time.
4. **120 leads stranded at `stage: queued`** across two dead runs (the 08-03 C3 duplicate
   and the 08-05 13:05 run that died on the Inngest key). Nothing reaps them.
5. **Leads can hang at `external_evidence` forever.** Two leads on the 08-05 run stopped
   there with no error and no timeout row; `lib/instagram/steel-acquisition.ts` has an
   in-code timeout that did not fire. Reports as a clean run — a ~13% silent loss.

---

## Re-deriving these numbers

All read-only. Use `createAdminClient` from `@/lib/supabase/admin` in a `.mts` script and
`npx tsx`, per the repo root `CLAUDE.md`.

```sql
-- KPI 1: review rate (ALWAYS filter out the 2026-08-01 batch)
select decision, count(*) from lead_qualification_decisions
where created_at >= '2026-08-02' group by decision;

-- KPI 1: causes, ranked
select unnest(decision_reasons) as reason, count(*) from lead_qualification_decisions
where created_at >= '2026-08-02' and decision = 'review'
group by reason order by count(*) desc;

-- KPI 3: cost inputs (multiply by the rates above; estimated_cost_usd is always 0)
select run_id,
       sum(extraction_input_tokens)  as ext_in,  sum(extraction_output_tokens)  as ext_out,
       sum(challenger_input_tokens)  as chl_in,  sum(challenger_output_tokens)  as chl_out,
       count(*) filter (where decision = 'qualified') as qualified
from qualification_run_leads group by run_id;

-- Seed attribution: join run leads -> leads.source_seed_id -> seeds.username
-- Stage distribution / stuck leads
select stage, status, count(*) from qualification_run_leads group by stage, status;
```
