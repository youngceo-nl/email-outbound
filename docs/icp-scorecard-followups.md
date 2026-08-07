# ICP scorecard — what's left to fix

Findings from implementing "Revised Instagram ICP Qualification Logic.pdf"
(gates + 12-point scorer, `lib/qualification/icp-gates.ts` / `icp-score.ts` /
`decide.ts`) and running it against 40 real leads via
`scripts/qualify-profiles.ts` (`qualified-not-outreached.csv` sample, no
`--persist`). Ordered by impact.

## 1. Gate 4 doesn't credit application/booking funnels as strong evidence [x]

**Evidence:** 32 of 40 real leads hit `relevant_offer_gate_uncertain` or
`_failed`. Two of them — `@adelman.aspires` and `@heatherblankenshipx3` —
scored a perfect 12/12 with `certainty: high` and still landed in
`MANUAL_REVIEW` instead of `QUALIFIED_HIGH_PRIORITY`, purely because Gate 4
only accepts an extractor-confirmed `is_paid: "paid"` as strong evidence.
Both leads have a Calendly/application "book a call to see if you qualify"
funnel — the standard high-ticket-coaching pattern where price is
deliberately withheld until the call, not disclosed on the public page.

**The gap:** the PDF's own Gate 4 "Strong evidence" list (page 4) includes
"Application funnel" and "Book a consultation" as their own sufficient
evidence — not just price/payment text. My implementation
(`evaluateRelevantOfferGate` in `icp-gates.ts`) collapsed every form of
strong evidence into a single `offer.is_paid === "paid"` check and never
looks at the destination/CTA data for an application or booking funnel.

**Fix:** in `evaluateRelevantOfferGate`, treat a relevant offer as passing
when EITHER `is_paid === "paid"` OR the offer's evidence connects to a
captured destination with `destination_type: "application" | "booking"`
(already computed, see `snapshot.external_destinations`) or a CTA action
matching "apply"/"book a call"/"schedule". Needs a new unit test mirroring
the two real leads above (offer with no price, but an application-funnel
destination → pass, not uncertain).

## 2. The CLI batch path never exercises Gate 2's vision half [x]

**Evidence:** all 40 batch-tested leads went through Apify acquisition via
`scripts/qualify-profiles.ts`, which never calls
`lib/instagram/profile-images.ts::persistLeadImages`. Every lead's
`visual_evidence` was empty, so `runVisualIdentity` short-circuited with
`facts: null` on all 40 — Gate 2 ran on the text signal alone every time.
Vision has only been verified once, live, against `@yoahkonar_` through a
one-off script, never through a real batch.

**Why it matters:** production acquisition (Steel, via
`inngest/functions/acquire-profile.ts`) already wires images correctly. The
CLI path — the tool used for exactly this kind of batch evaluation — does
not, so batch runs systematically under-test half of Gate 2 and can't
surface vision-specific bugs (like the `minimum` schema bug already caught
and fixed once) at scale.

**Fix:** either (a) add Apify-sourced `profile_pic_url` + post-thumbnail
image persistence to `scripts/qualify-profiles.ts`, mirroring the
`buildImageCandidates`/`persistLeadImages` call already in
`acquire-profile.ts`, or (b) accept this as a known CLI limitation and only
batch-test vision through the Inngest path. (a) is more work but means the
CLI's "judge decision quality before it hits production" purpose actually
covers the full gate.

## 3. `lib/evidence/funnel-maturity.ts` has no unit tests [x]

Flagged when it was built, never closed. It's pure, low-risk (no network,
no model calls) but it's the entire input to the Funnel Maturity scoring
dimension and several review flags. Needs a `funnel-maturity.test.ts`
covering each of the 11 signal kinds firing/not firing against a synthetic
snapshot.

## 4. `docs/scoring-system.md` describes a retired system [x]

It documents the old 10-point `commercial_fit` scorer (`buyer_clarity`,
`authority_strength`, the highlight-bonus mechanic) as the current pipeline.
That system was fully replaced this session — the doc is now actively
misleading to anyone using it as a reference. Needs a rewrite describing the
four gates, the six-dimension 12-point scorer, and the `qualification`
tier — same structure, new content.

---

## Deliberately deferred (not bugs — flagging for visibility, not action)

- `leads.status` stays a native Postgres enum with the old
  `qualified/review/rejected/pending` vocabulary; the PDF's literal tier
  lives in the new `qualification` column and `leads.qualification_outcome`
  instead. Explicit tradeoff made during implementation to avoid an
  `ALTER TYPE` on a column other things depend on — see the plan doc.
- No dedicated review-UI panel for the four gates / six dimensions.
  `pipeline-stages.ts` and `scoreColor()` were corrected so nothing silently
  shows wrong data, but there's no new breakdown view.
- The full 438-lead `qualified-not-outreached.csv` backlog hasn't been
  re-scored — only a 40-lead sample. A full re-score is straightforward once
  #1 above is fixed (no point re-running the full backlog against a gate
  that's about to change).
- The Steel-specific rendered-funnel path (`buildDestination` reuse in
  `playwright-instagram-complete.ts`, `capture_method: "rendered"`) has never
  run against a live Steel session in this environment — no browser/cookie
  infra reachable from here. Everything downstream of it is unit-tested;
  the live acquisition step itself is not.
