# Scoring targets — what we're aiming at, and what to do next

All numbers measured 2026-08-06. Full workings: [baseline-2026-08-06.md](baseline-2026-08-06.md).

## Where we are

| KPI | Now | Target |
|---|---|---|
| Leads sent to manual review | **62%** | **5%** |
| Leads scored correctly | **unknown** | ~100% |
| AI cost per **qualified** lead | **$0.33 – $0.76** | set one once it's stable |

## The one thing blocking us

**We can't tell if the scorer is right.** There's no set of leads a human has labelled,
so "accuracy" is an opinion.

That blocks the review target too. Getting review from 62% to 5% is easy on its own —
auto-decide everything. It's only an *improvement* if those leads get decided correctly.
Right now we could not tell the difference between fixing it and quietly breaking it.

The only real evidence we have: 3 leads reviewed by hand on 08-05. The scorer sent all 3
to review. All 3 should have been qualified. Wrong 3 out of 3, always the same
direction — too cautious.

## Do these, in order

### 1. Label 30–50 leads by hand
Go through decided leads and mark each one qualified or rejected. That's the measuring
stick — without it, steps 2 and 3 are guesswork and every future scorer change is a
blind trade.

What counts as qualified (your own words, 08-05):
- Sells an **info offer** — community, 1:1 coaching, course. **Ticket size doesn't matter.**
- Funnel says high-ticket if the next step is **booking a call**.
- Client results showing **students** = good sign.
- **Bigger promised transformation** = more likely high-ticket.
- **Serving agency owners ≠ being an agency.** Ask what they *sell*, not who they serve.

### 2. Test a seed before running a batch on it
Run 20 leads from a new seed, check the ICP rate, commit only if it clears ~30%.

This is the biggest lever we have and it isn't about the pipeline at all:

| seed | qualified / requested |
|---|---|
| `@mannyfrometa` | 5 / 150 (3.3%) |
| `@iamjadenly` | 5 / 20 (25%) |

**7.5x difference from the seed alone.** Same pipeline, same scorer. A bad seed means
paying full price for leads that were never going to qualify — the C4 run spent $1.73
on 50 leads and qualified **zero**.

### 3. Fix `missing_core_evidence`
It causes **60% of all reviews**. It doesn't mean a lead is borderline — it means we
never gathered enough to decide. So the path to 5% is mostly better evidence gathering,
not better scoring rules. Tuning thresholds only touches the bottom 30%.

## Cost note

Only ever measure cost **per qualified lead**. Cost per *decided* lead makes the worst
run look best: C4 was the cheapest per decision ($0.044) and produced nothing.

The Opus challenger is **69% of spend**. It's the obvious thing to cut — but don't,
until step 1 is done. It exists to catch scoring errors, and cutting it without a
labelled set trades unknown accuracy for known money.
