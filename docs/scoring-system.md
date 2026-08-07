# Lead Scoring System — Current Layout

Reflects the code paths as of 2026-08-06, pipeline version
`commercial-qualification-1.0.0`, scorecard `icp-gates-score-v1`. This is the
second generation of this pipeline: it replaces the original 10-point
`commercial_fit` scorer with the four hard gates and 12-point six-dimension
scorer from "Revised Instagram ICP Qualification Logic.pdf" — not a shadow,
the live routing.

**The AI never scores or gates.** Claude Haiku reads a frozen evidence
snapshot and returns cited *facts*, plus a separate vision pass reads stored
profile/post images for the one fact text can't establish (is a person
visible, and is it the same person). Deterministic code turns those facts
into gate outcomes, a score, and a decision. Claude Opus is brought in only
as an adversarial second opinion on the calls where being wrong is expensive.

```
lead
  │
  ▼
┌──────────────────────────┐  no bio link → dropped (no_bio_link)
│ 0. Bio-link pre-filter   │───────────────────────────────────────────────────►
└──────────────────────────┘  (batched Apify, before any browser session)
  │
  ▼
┌──────────────────────────┐  excluded  → rejected (universal exclusion)
│ 1. Sufficiency gates     │───────────────────────────────────────────────────►
└──────────────────────────┘  retryable → data_retry
  │
  ▼
┌──────────────────────────┐
│ 2. Acquisition           │  Instagram (+ profile/post images) → bio link +
│    → evidence snapshot   │  CTA chain → YouTube → bounded 2nd external pass.
└──────────────────────────┘  Frozen before any model sees it.
  │
  ▼
┌──────────────────────────┐  invalid output → review (ai_output_invalid)
│ 3. Extraction (Haiku 4.5)│───────────────────────────────────────────────────►
└──────────────────────────┘  cited facts only — no scores, no decisions
  │
  ▼
┌──────────────────────────┐  no images captured → facts: null, never an absence
│ 4. Visual identity       │───────────────────────────────────────────────────►
│    (Haiku 4.5 + vision)  │  is a person visible, and is it the same person
└──────────────────────────┘
  │
  ▼
┌──────────────────────────┐  reject / manual_review → skip straight to routing
│ 5. ICP gates              │  follower floor · personal brand · coach or
└──────────────────────────┘  consultant · relevant offer
  │
  ▼
┌──────────────────────────┐
│ 6. ICP score              │  pure code, versioned scorecard, six dims → 0–12
└──────────────────────────┘  computed for EVERY lead, gated or not
  │
  ▼
┌──────────────────────────┐
│ 7. Certainty              │  "could we see enough to decide automatically?"
└──────────────────────────┘
  │
  ▼
┌──────────────────────────┐
│ 8. Challenger (Opus 5)    │  only on auto-approvals, mixed offers, conflicts
└──────────────────────────┘
  │
  ▼
┌──────────────────────────┐
│ 9. Routing                │  qualified / review / rejected / data_retry
└──────────────────────────┘
  │
  ▼
┌──────────────────────────┐
│ 10. Priority               │  ranking only — can never change the decision
└──────────────────────────┘
```

Entry point: `inngest/functions/qualify-lead.ts` (event
`lead/qualification.requested`). Orchestrator: `lib/qualification/run.ts`.
The legacy `lead/score.requested` event is adapted onto this path by
`inngest/functions/score-lead.ts`.

---

## 0. Bio-link pre-filter (`lib/pipeline/prefilter.ts`)

Steel acquisition is the pipeline's hardest throttle — one lead at a time behind
a 180s browser session. Apify returns profiles in batches of 50; any lead the
actor **positively returned with an empty bio link** is dropped before it gets a
session. No link means no landing page to crawl and no funnel to read.

Fails open by design: a username the actor did not return is *unknown*, not
linkless, and goes through to Steel. A cheap filter that breaks must cost money,
never leads.

Rejection reason: `no_bio_link`.

## 1. Sufficiency gates (`lib/evidence/sufficiency.ts`, pre-AI)

Keeps two very different failures apart:

- **"we could not see the profile"** → `data_retry`, never a rejection
- **"we saw the profile and it is disqualifying"** → deterministic reject

Only reliable, ICP-independent disqualifiers run here. Anything needing
interpretation across bio, CTA, and landing pages belongs to the gates below.

| Check | Outcome |
|---|---|
| Profile capture failed / not captured | `retryable` |
| Non-ICP identity — fan page, parody, meme page, gossip, repost page, quotes page, news page | `excluded` |
| Private **and** no bio **and** no external link | `excluded` |
| Private but with readable evidence | proceeds, flagged `bio_only_evidence` |

Identity patterns are matched against **display name, username, and category
only** — never the bio, where a legitimate coach may well use the word "memes"
in passing.

The gate also stamps **data quality**, which follows the lead all the way to the
decision:

- `complete` — bio present, posts captured, non-empty sample
- `partial` — bio present, post sample incomplete
- `unreliable` — posts claimed but none returned, or no bio at all

Unreliable data is a retry, never a rejection: a missing post sample must not be
read as an inactive account.

## 2. Acquisition — the evidence snapshot (`lib/evidence/collect.ts`)

Surface order is load-bearing: **Instagram first** (it names every other
surface), then external destinations from the bio link, then YouTube, then a
bounded second external pass for commercial links found inside YouTube
descriptions.

Budgets (`DEFAULT_EXTERNAL_CONFIG`, `lib/evidence/external.ts`):

| Budget | Value |
|---|---|
| CTA hops | 3 default, 5 absolute |
| Child links per page | 3 default, 5 max |
| Pages fetched | 6 |

Acquisition is plain HTTP by default — a landing page that ships its offer only
after JavaScript is captured as thin rather than as a fetch failure. **Steel
acquisition is the exception**: `inspectFunnel`
(`scripts/experiments/playwright-instagram-complete.ts`) renders the bio-link
funnel in the same authenticated browser session used for Instagram, using the
same deterministic `extractPage`/`buildDestination` as the plain-HTTP path. When
present, these rendered destinations (`capture_method: "rendered"`) **replace**
the plain-HTTP pass for that lead rather than merging with it — they already
reflect JS-only content the HTTP fetcher can never see.

Two other things ride along in the same snapshot:

- **Profile and post images.** `lib/instagram/profile-images.ts` downloads the
  profile picture and up to 9 post thumbnails and uploads them to the private
  `lead-images` storage bucket — Instagram's CDN URLs are signed and expire
  within days, so the bytes are captured once, at acquisition time, to keep the
  snapshot genuinely replayable. This is what stage 4 (visual identity) reads.
- **Deterministic page signals**, all in `lib/evidence/page-extract.ts`:
  `paid_offer_signals` (checkout/enrolment/price-commitment language and known
  checkout-platform hosts), `offer_status_signals` ("doors closed", "waitlist",
  a past cohort date), and `tracking_signals` (Meta/TikTok/Google Ads pixels,
  GTM — read from the raw HTML *before* scripts are stripped for the excerpt).
  These seed the extractor's offer `is_paid`/`active_status` fields and the
  Funnel Maturity signal inventory below.
- **`funnel_maturity_signals`** (`lib/evidence/funnel-maturity.ts`) — a
  deterministic inventory of 13 signal kinds (name-field positioning, bio
  promise, application/booking/webinar/lead-magnet funnels, Results/Start
  Here/Offer highlights, a pinned post, retargeting pixels, ≥2 CTAs, a named
  methodology), each with its own citation. Feeds the Funnel Maturity scoring
  dimension directly — nothing here is invented, and highlights are evidence
  for this dimension specifically, not a bonus applied elsewhere.

The snapshot is assembled and **frozen before any model sees it**. That is what
makes every later stage replayable — see [Versioning and replay](#versioning-and-replay).

## 3. Extraction — Claude Haiku 4.5 (`lib/qualification/extract.ts`)

Haiku receives a compressed evidence packet built from the stored snapshot and
returns structured facts with citations. **It scores nothing and decides
nothing.**

Two focused structured passes over the same packet — `signals` and `commerce` —
because the full field set compiles to a grammar the backend rejects (see
`haiku-contract.ts`; the signals pass sits at 11 top-level fields, right at the
observed ceiling). Temperature 0, native JSON schema, 8000 max tokens.

Returned per dimension: audience, transformation, information funnel, CTA,
proof, authority, **and `coach_or_consultant`** — each with a state
(`present` / `absent` / `unknown` / `conflicting`), an anchored label, and
citations. `coach_or_consultant` accepts the spec's semantic pass signals
("I help agency owners scale past €100k/month") as well as literal titles.
Every offer in the inventory additionally carries `is_paid`
(`paid`/`free`/`unknown`) and `active_status` (`active`/`inactive`/`unknown`),
seeded by the deterministic paid-offer/offer-status signals above and
confirmed by the model rather than invented from nothing. Plus business
models, the primary visitor outcome, the CTA chain, an agency evidence
bundle, and any conflicts the extractor noticed.

Three validations run in application code:

1. **Affirmative citations** — every affirmative claim must be cited. This is
   the anti-hallucination rule structured output cannot express.
2. **Citations resolve** — every cited source id must exist in the snapshot that
   was actually inspected.
3. **Phrases appear** — soft check that the quoted phrase occurs in the snapshot
   text. A *warning*, not a failure, because the spec permits faithful
   normalization and translation, both of which change characters while
   preserving meaning. More than 3 warnings caps certainty.

A malformed response gets **exactly one structured repair attempt**, then routes
to `review` with `ai_output_invalid`. It never falls back to guessing a business
model, because a guessed model is indistinguishable from an evidenced one once
it is stored. Invalid model output is a scoring error, never a rejection —
rejecting here would silently convert an infrastructure failure into a lost
lead.

## 4. Visual identity — Claude Haiku 4.5 with vision (`lib/qualification/visual-identity.ts`)

Answers exactly one question the text extractor cannot: is an identifiable
individual central to this account, and is it the same person across images.
Reads the profile picture plus up to 9 stored post thumbnails from the
`lead-images` bucket. **Never called when no images were captured** — a
snapshot with nothing to look at short-circuits to `facts: null` at zero
cost, which Gate 2 below treats as `unknown`, not as evidence of absence.

Returns `individual_visible` and `recurring_individual`
(`present`/`absent`/`unknown`), a person-count, and cited evidence per image.
Same anti-hallucination discipline as text extraction: a non-`unknown` state
requires a citation to an image actually attached to the request, checked
against the exact image list sent. One structured repair attempt on failure,
same as extraction.

## 5. ICP gates (`lib/qualification/icp-gates.ts`)

The four hard gates from the spec, evaluated **before any score exists** and
never overturned by one. Order matches the spec's "Immediate Classification
Logic" exactly — any clear fail rejects, any uncertain gate sends the lead to
a human, and only a lead clearing all four ever reaches the scorer.

**Gate 1 — Minimum Audience Size.** `followers < 5,000` → reject
(`follower_below_minimum`). `followers` not captured → `MANUAL_REVIEW`
(`follower_count_unknown`), never silently pass or fail. Configurable via
`followerRange`, defaulting to the spec's own 5,000-follower floor with no
ceiling.

**Gate 2 — Personal Brand.** Combines the text `human_personal_brand` signal
with the vision pass. PASS is reachable from **either** signal alone reading
`present` — vision is corroborating evidence, not a requirement, since many
snapshots have no captured images at all. FAIL requires that **neither**
signal contradicts an absence (both reads no positive evidence and at least
one reads `absent`) — a genuine present-vs-absent disagreement between text
and vision always resolves to PASS, never a forced reject, matching the
spec's own "ambiguous accounts" guidance that a branded account still passes
when a specific founder is clearly the face.

**Gate 3 — Coach or Consultant.** `coach_or_consultant` present → pass.
Absent → the **agency-owner exception**, which reuses
`findIndependentInformationFunnel` (`eligibility.ts`, the same function the
pre-existing hard business-model gate below uses) rather than duplicating it.
The exception only fires when the profile actually shows agency evidence
(a primary `agency_service` business model or a non-absent agency evidence
bundle) — checking this first matters, because the reused function's
fallback path ("is there any offer with its own CTA") verifies for
practically any normal coaching business and would otherwise turn every
absent-coach lead into "uncertain" regardless of whether an agency was ever
involved.

**Gate 4 — Relevant Offer.** Fails when no offer is a coaching/course/
consulting/community/membership/event type. Otherwise passes on **either**
of two independent forms of strong evidence — an offer confirmed
`is_paid: "paid"`, **or** a relevant offer connected to a captured
application/booking-funnel destination, or whose own CTA text says
"apply"/"book a call"/"schedule a call". The second path exists because the
spec's own "Strong evidence" list treats an application/booking funnel as
sufficient on its own — high-ticket coaching offers routinely withhold price
until the call by design, and requiring price confirmation alone sent leads
with a real, live application funnel to manual review for no reason the spec
actually supports. Either way, a `information_funnel: absent` reading still
downgrades the gate to uncertain — strong offer evidence is only as
trustworthy as the funnel evidence behind it.

An `unknown`/`conflicting` `information_funnel` or `cta` signal has no
gate of its own — see step 4 of [Routing](#9-routing-libqualificationdecidets) below for
why that still blocks straight-through scoring.

## 6. ICP score (`lib/qualification/icp-score.ts`)

Pure label/count-to-point mapping under the versioned scorecard
(`lib/qualification/scorecard.ts`, `icp-gates-score-v1`). No model
involvement — **computed unconditionally for every lead**, gated or not, so a
hard-rejected agency still carries its commercial strength for analysis
without that strength ever being able to restore eligibility.

| Dimension | Range | Source |
|---|---|---|
| **audience_specificity** | 0/1/2 | `audience.label`: none→0, broad/inferred→1, specific/explicit→2 |
| **transformation_clarity** | 0/1/2 | `transformation.label`: none→0, inspirational/expertise_only→1, implied_result/explicit_result→2 |
| **offer_clarity** | 0/1/2 | composite over the primary offer: type+audience+result/delivery all populated →2, offer visible but incomplete →1, unclear →0 |
| **conversion_path** | 0/1/2 | `cta.label` ladder, boosted to 2 by any detected DM/comment-keyword funnel (`snapshot.direct_response_ctas`) regardless of label |
| **proof** | 0/1/2 | `proof.label`: absent→0, weak→1, credible/strong→2 |
| **funnel_maturity** | 0/1/2 | count of `present` entries in `funnel_maturity_signals`: 0→0, 1–3→1, 4+→2 |

`total_icp_score` = sum, 0–12. `offer_clarity` and `funnel_maturity` are not
label ladders — they're computed directly in `icp-score.ts`, not configured
in the scorecard, because neither is a simple extractor-label lookup.

There is **no highlight bonus mechanic** under this scorecard (unlike the
retired 10-point system below). The spec treats highlights as evidence
feeding Funnel Maturity specifically — already captured via
`funnel_maturity_signals`'s Results/Start Here/Offer highlight kinds — so a
separate bonus on top would double-count the same highlight titles into two
dimensions. `authority` is also retired as a scored dimension; it's Gate 2
evidence now, not a score.

An **unmapped label** surfaces as an explicit scorecard/extractor version
mismatch rather than quietly scoring 0.

## 7. Certainty (`lib/qualification/certainty.ts`)

Unchanged by the PDF work — genuinely separate infrastructure the spec
doesn't address at all (it names a `confidence` field with no derivation
rule). Derived by application code from what was actually captured — **never
a probability the model emitted about itself**. Certainty answers "could we
see enough to decide automatically?", which is a different question from "is
this lead good?" and must not be conflated with `total_icp_score`.

Two deliberately separate bars, because the risks are opposite. Approving
wrongly puts a bad lead into outreach; declining to chase a clothing brand does
not need the same evidence.

**`deriveCertainty` — confidence to APPROVE.** `high` requires all of:

- acquisition sufficiency is `sufficient`
- the CTA chain resolved to an ultimate outcome
- the primary visitor outcome is known
- every proof claim has a beneficiary
- the (pre-existing) core gate passes
- if YouTube is the primary CTA, at least one video description was inspected
- ≤3 unverified citation phrases
- the challenger agrees, *where it was warranted*

Any `unknown` or `conflicting` core signal, an uncaptured profile, unreliable
data, an uncertain/mixed track, a disagreeing challenger, or unresolved
conflicts force `low` outright. One noncritical gap yields `medium`.

**`deriveRejectionConfidence` — confidence to REJECT.** Asks only "did we
actually *see* what we are judging":

- profile was captured
- no `unknown` core signals (`absent` is a finding and does **not** block)
- the business model resolved (not uncertain, not mixed)
- data is not unreliable
- the challenger, if it ran, did not dispute the extraction

> Conflating these two deadlocked the pipeline. Gating auto-rejection behind
> `certainty === "high"` made it unreachable whenever the challenger had not run
> — and it runs on a minority of leads. On the 2026-08-03 100-lead run not one
> of 75 leads reached `high`, so 60 leads scoring at or below `rejected_max`
> went to a human instead of being rejected. The review queue was 64 leads of
> which only 4 genuinely needed an opinion.

This same `canAutoReject` bar now also gates whether an ICP-gate reject or a
below-threshold score band actually executes as an automatic `rejected`, or
downgrades to `review` — see [Routing](#9-routing-libqualificationdecidets).

## 8. Challenger — Claude Opus 5 (`lib/qualification/challenger.ts`)

Unchanged by the PDF work. A narrow adversarial second pass over the same
evidence, run only where a wrong answer is expensive. It looks for missed
done-for-you evidence, unsupported citations, and unresolved CTA outcomes.
**It is never asked for a replacement score or gate verdict.**

Triggers, in order:

| Trigger | Condition |
|---|---|
| `proposed_auto_approval` | would auto-approve if the challenger agreed — i.e. `qualification === "QUALIFIED_HIGH_PRIORITY"` |
| `mixed_offers` | agency and information offers both look primary |
| `conflicting_evidence` | the extractor reported ≥1 conflict |
| `audit_sample` | explicitly sampled for audit |

It deliberately does **not** run on reliable hard exclusions or acquisition
failures: a second opinion on a profile we could not even load buys nothing, and
a reliably excluded agency is not a close call.

Only **material** disagreements count (`findMaterialDisagreements`). The
challenger rating proof `credible` where the extractor said `strong` changes
nothing about eligibility; the challenger finding a done-for-you primary model
changes everything. Material disagreements are: an agency or uncertain business
model conclusion, a failing core gate, reliable agency evidence, reading
`information_funnel` or `cta` as absent/conflicting where extraction read
present, visitor outcomes that exclude the extracted primary, or insufficient
acquisition.

An unparseable challenger is an **unknown, not an endorsement** — its tokens are
still reported.

**Cost.** Extractor and challenger are priced per model and summed, never from a
pooled token count (`lib/qualification/pricing.ts`). Opus is 5× Haiku on both
input and output; reporting one blended total is what hid the challenger —
firing on a minority of leads — being the majority of a run's spend.

## 9. Routing (`lib/qualification/decide.ts`)

Order is the whole point:

**1. Pre-existing hard business-model gate** (`eligibility.ts`) — runs first
and unchanged from before the PDF work. A reliable `done_for_you_service`
primary outcome is rejected outright
(`primary_offer_done_for_you_service`). Kept ahead of the PDF's own four
gates because it encodes more nuance (mixed-offer handling, the "agency
evidence next to an information outcome" false-positive defense) than Gate
3's exception alone, and rewriting tested, incident-driven behavior the spec
doesn't address would have thrown it away for nothing.

> **The agency exception.** The one escape is a genuinely independent
> information funnel: all five components — own audience, own transformation,
> own CTA path, information delivery, sufficient prominence — must be `present`
> and cited. A funnel missing any one of them is a bonus attached to the
> service, not a business that stands on its own. When the exception passes,
> the lead goes to **review** later in this list, not auto-qualify.

**2. Data quality** — uncaptured profile → `data_retry`. Unreliable data with
unknown core signals → `data_retry`. Runs before the ICP gates so an unseen
profile is never evaluated against Gate 1's follower count as if it were a
considered "unknown" judgment.

**3. The four ICP gates** (§5 above). Any clear fail → `REJECTED`; any
uncertain gate → `MANUAL_REVIEW`. Note the tier assigned here is the literal,
honest answer regardless of confidence — see the `qualification` vs
`decision`/`mode` split below.

**4. Unknown `information_funnel` or `cta`.** Neither has a gate of its own
in the spec — Gate 2 already folds `human_personal_brand`'s unknown case
into "uncertain", but a profile whose funnel or CTA was simply never
captured has no PDF-gate equivalent to catch it. This pipeline's core safety
invariant (an unseen surface must never be treated as though it were fine)
still applies, so this is checked explicitly before scoring: → `MANUAL_REVIEW`
(`core_signal_unknown`).

**5. Unresolved business model** (pre-existing hard gate's mixed case) →
review.

**6. Score band**, from `total_icp_score` against the scorecard thresholds:

```
10–12  →  QUALIFIED_HIGH_PRIORITY
7–9    →  QUALIFIED
4–6    →  MANUAL_REVIEW
0–3    →  REJECTED
```

**7. Automatic approval** — `QUALIFIED_HIGH_PRIORITY` only, and only when
*every* blocker is clear: certainty must be `high`, and the challenger must
not disagree. Any blocker → outcome `qualified`, mode `manual_review`.

### `qualification` vs `decision`/`mode`

`qualification` — the PDF's literal `QUALIFIED_HIGH_PRIORITY` /
`QUALIFIED` / `MANUAL_REVIEW` / `REJECTED` — is a **pure function of the
gates and the score**, always the honest answer regardless of how confident
the pipeline is in acting on it automatically.

`decision` (`qualified`/`review`/`rejected`/`data_retry`) and `mode`
(`auto_approved`/`manual_review`/`hard_excluded`/`retry_required`) are the
**operational routing** — the same confidence/certainty safety net this
pipeline has always applied before executing anything irreversible. The two
can genuinely diverge: a lead can carry `qualification: "REJECTED"`
alongside `decision: "review"` when `canAutoReject` (from
`deriveRejectionConfidence`) says the evidence isn't complete enough to
execute that rejection without a human. This is not a shortcut — it's
strictly more transparent than silently downgrading the tier, and it
preserves the exact asymmetric-risk posture that fixed the review-queue
deadlock described in §7.

`leads.status` (a native Postgres enum) and the `decision`/`mode` columns
keep their pre-existing constrained vocabulary — `qualification` lives in a
new, separately-constrained `lead_qualification_decisions.qualification`
column and in `leads.qualification_outcome` (already unconstrained text),
rather than requiring an `ALTER TYPE` on a column other things depend on.

**Outcomes:** `qualified` · `review` · `rejected` · `data_retry`.
**Modes:** `auto_approved` · `manual_review` · `hard_excluded` · `retry_required`.

**Review flags are advisory and never decide an outcome on their own:**
`agency_information_mixed`, `uncertain_track`, `contradictory_evidence`,
`unreliable_data`, `missing_core_evidence`, `proof_unverified`,
`authority_unverified`, `follower_range`, and `suspicious_proof` — the last
firing when agency-client proof props up an information claim, the classic false
positive this ICP has to defend against.

`track` (`classify-track.ts`) and the pre-existing core gate
(`applyCoreGate`) are both still computed — `track` for review-flag purposes
and the stored field, `coreGate` for certainty and the unknown-signal check
in step 4 — but **neither is a standalone elimination step anymore**; the
four ICP gates and the score band do that job now.

## 10. Priority (`lib/qualification/priority.ts`)

Runs only after qualification and can never change it. Applies to `qualified`
and `review` outcomes only.

| Component | Weight | Normalized by |
|---|---|---|
| commercial_fit | 50% | `total_icp_score` / 12 |
| proof_maturity | 15% | `proof` dimension / 2 |
| reel_view_rate | 15% | / 0.5 |
| posting_recency | 10% | 1 − days_since_latest_post / 60 |
| posting_consistency | 10% | posts_last_30_days / 12 |

Field/weight-key names (`commercial_fit`, `proof_maturity`) are unchanged
from the retired scorer even though what feeds them changed — only the
normalization inputs moved, so nothing downstream needed reshaping.

Unknown metrics contribute **no penalty** — they redistribute their weight onto
the components we actually measured, so a lead with a broken post sample is not
quietly ranked below an identical lead whose scrape happened to succeed. The
result carries `data_completeness` (`complete` / `partial` / `unknown`).

## Versioning and replay

Every stored decision references seven version strings
(`lib/evidence/versions.ts`):

```
acquisition-1.1.0 · personal-brand-evidence-v2 · personal-brand-challenger-v1
icp-gates-score-v1 · gate2-visual-identity-v1 · config-v1
commercial-qualification-1.0.0
```

Changing traversal behavior, page extraction, prompt wording, or any
label-to-point mapping **requires bumping the corresponding version** —
otherwise two decisions carrying the same version string are not comparable and
the shadow benchmark silently lies. This is why the scorecard lives in
configuration rather than inside the scoring code. `SCORECARD_VERSION` moved
from `personal-brand-score-v1` to `icp-gates-score-v1` when the 12-point
scorer replaced the 10-point one — decisions under the two versions use
completely different point mappings and are not comparable.

Because the snapshot is immutable, `requalifyFromSnapshot` (`run.ts`) replays a
new prompt, a new scorecard, a new vision pass, or a different model against
exactly the bytes that produced an earlier decision — no re-scraping, no
drift, and no dependency on the profile still looking the way it did. A
snapshot captured before `acquisition-1.1.0` has no images and no rendered
funnel, so it replays into Gate 2's vision half and paid-offer evidence as
`unknown` rather than a wrong answer — never silently treated as absent.

## Notes

- The `qualified-not-outreached.csv` backlog (438 leads, scored under the
  retired 10-point system) has not been re-scored under the new gates —
  see `docs/icp-scorecard-followups.md` for the sample-tested findings so
  far and what's still open.
- The pre-2026-08 system — hard filter + metrics gate → OpenAI/Claude/Gemini/Groq
  classification → `lib/scoring/compute.ts` weighted sub-scores — is superseded.
  `lib/scoring/` and `lib/{openai,gemini,groq}/classify.ts` are now referenced
  only by each other; nothing on the live path calls them. This is a separate,
  earlier supersession from the 10-point → 12-point scorecard change above.
