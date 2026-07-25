ja we moeten het Al scoring systeem gewoon verbeteren. daar hebben we data voor
nodig. Ik heb goed idee.
Ik maak snel een manual scoring feedback systeem die het systeem traint. dan hoef ik
alleen dat te doen
enrichment gaat dan naar VA
en dan bereken ik gemiddelde goedkeuring en als die beter is, haal ik de manual system
er uit

so we need a system that allows for quick manual lead scoring + feedback to train the system

only those leads who are manually scored enter the handover phase. 

then the system automatically tracks the percentage that were bad leads. and we keep improving the AI scoring system until the bad lead percentage is only 5% or lower

plan comes here ------------------------ 

## Plan

**The idea in one line:** insert a fast manual review step *after* AI
qualification. A human approves/rejects every AI-`qualified` lead. Only
approved leads reach handover (so Clay/VA budget is never spent on bad leads),
and the reject rate becomes a hard KPI. We tune the AI until that
**bad-lead rate ≤ 5%**, then the manual step can be dropped.

Decisions (confirmed):
- AI still qualifies first; every qualified lead is then manually scored.
  **Only manually-approved leads enter handover** — the existing qualified
  backlog becomes the initial review queue (reviewing it *is* the
  data-collection step, so that's intended).
- UI: a **focused review page**, one lead at a time, keyboard-driven.
- KPI = **AI false-positive rate** = `rejected-during-review ÷ total-reviewed`.

### Reused, not rebuilt
- `rejected_leads` + `BAD_LEAD_CATEGORIES` (`lib/leads/bad-lead.ts`) — the
  labeled-negative training data. Reject records here, like `markBadLead` does.
- AI prompts (`lib/{openai,claude,gemini,groq}/classify.ts`) + deterministic
  scoring (`lib/scoring/compute.ts`, threshold `crawl_score_threshold`) — these
  are what a human *tunes* using the KPI; untouched by this feature.
- `scoreColor`, `Badge`, `Button`, `Popover`, `select`, and the
  category-popover pattern from `mark-bad-lead-button.tsx`.

### 1. Migration (Management API, not `db push`)
Add to `leads`: `review_decision text check in ('approved','rejected')`,
`reviewed_at timestamptz`, `reviewed_by uuid`. Kept as its own axis so a lead
approved-then-Clay-flagged never corrupts the KPI. Partial indexes for the
queue (`status='qualified' and review_decision is null`, by score) and the KPI
(`reviewed_at where review_decision is not null`). Functions:
`review_stats(p_since timestamptz)` → `(approved, rejected, reviewed)`, and
`review_stats_by_day(p_days int)` for the trend toward 5%.

### 2. `app/actions/review.ts` (the only writer of `review_decision`)
`approveLead` (stays qualified), `rejectLead` (sets reject verdict + records
`rejected_leads` + `status='rejected'`, `handover_batch_id=null`),
`getReviewQueue`, `getReviewStats`, `undoReview`. `markBadLead` stays untouched
so the KPI reflects only the review-queue verdict.

### 3. Handover gate
Add `review_decision='approved'` to the three pool predicates in
`lib/handover/batch.ts` (`getPoolCount`, `claimBatch`) and
`lib/handover/overview.ts` (`getAccountHandoverStats`).

### 4. Review page — `app/(dashboard)/review/page.tsx` + `ReviewClient`
Focused one-at-a-time card: score pill, @username, niche · business_model, bio,
`reason_for_score`, metrics, links. Approve / Reject▸(category + note).
Keyboard: `a` approve, `r` reject, `j`/`k` skip, `u` undo. KPI header shows the
bad-lead % (all-time + last 7 days) vs the 5% target. New "Review" nav entry
with a pending-count badge.

### Out of scope
Auto few-shot training (feeding rejected examples back into the LLM prompt) is a
deliberate later step — this pass builds the data-collection + measurement loop.
Surfacing `crawl_score_threshold` in the settings form is optional.

### Verification
`tsc`/`eslint`/`build`; migration via Management API; hand-verify
`review_stats()` against a manual count; browser-check that approved leads
become claimable, rejected ones drop into the Bad leads table, the KPI matches a
manual count, and a fresh unreviewed lead is absent from the handover pool until
approved.