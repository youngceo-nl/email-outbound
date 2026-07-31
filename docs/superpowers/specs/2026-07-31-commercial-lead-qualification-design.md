# Commercial lead qualification pipeline

_2026-07-31_

## Goal

Qualify Instagram leads according to whether they operate a credible,
expertise-based business that can buy the agency's service. The decision must
primarily reflect commercial fit, not social engagement. Activity and reach
help prioritize qualified leads, but weak likes, views, or posting cadence do
not independently disqualify a commercially strong lead.

The pipeline must explain every decision with stored evidence so a reviewer can
see why a lead qualified, entered review, or was rejected.

## Guiding principles

1. Commercial intent is the primary qualification signal.
2. A clear buyer, transformation, offer, CTA, and proof matter more than likes.
3. Missing scraper data is not evidence that the profile lacks activity.
4. Activity and reach rank qualified leads. They do not define qualification.
5. Obvious non-leads should be removed before an AI call when the evidence is
   reliable.
6. Borderline or ambiguous profiles go to manual review instead of being
   silently rejected.
7. The same evidence should produce the same decision regardless of which
   scrape or scoring entry point processed the lead.

## Desired funnel

```text
Profile discovered
    |
    v
Metadata quality check
    |
    +-- incomplete or unreliable --> retry backfill / data-quality queue
    |
    v
Universal exclusions
    |
    +-- definite exclusion -------> rejected
    |
    v
Commercial AI classification
    |
    v
Commercial-fit score
    |
    +-- 8.0 to 10.0 -------------> qualified
    +-- 6.0 to 7.5 --------------> manual review
    +-- 0.0 to 5.5 --------------> rejected
    |
    v
Priority score for qualified leads
    |
    v
Manual approval and enrichment
```

## Step 1: Collect the qualification evidence

The scorer receives the following normalized evidence:

- Username, display name, bio, category, verification status, follower count,
  following count, total post count, and external link.
- Up to 12 to 18 recent posts, including caption, timestamp, type, pinned
  status, likes, comments, and views when available.
- Pinned-post captions when the scraper can distinguish them.
- Profile highlights or labels when available, especially `results`,
  `testimonials`, `client wins`, `start here`, `my story`, and `apply`.
- Link-in-bio destination type and visible landing-page title when available.
- Previously extracted email and contact details.

The scorer must preserve the evidence timestamp. Social profile data changes,
so a decision is only reproducible when its input snapshot is identifiable.

### Story Highlight evidence

Story Highlight titles are a high-value positive signal because operators use
them as permanent profile-funnel navigation. Capture the normalized title and,
when technically available, the visible cover label. The initial version does
not need to scrape or interpret the stories inside each Highlight.

Normalize case, whitespace, punctuation, hyphens, and common singular or plural
variants before matching. Group titles semantically:

| Signal group | Example titles | Qualification evidence |
|---|---|---|
| Proof | `RESULTS`, `CLIENTS`, `REVIEWS`, `WINS`, `TESTIMONIAL`, `TESTIMONIALS`, `STUDENT WINS` | Client outcomes and operating maturity |
| Offer | `1-1 COACHING`, `COACHING`, `PROGRAM`, `WORK WITH ME` | A concrete paid offer |
| Funnel | `START HERE`, `FREE COURSE`, `APPLY`, `BOOK A CALL` | Deliberate conversion path |
| Authority | `MY STORY`, `YOUTUBE`, `PODCAST` | Founder identity and authority assets |

Matches are semantic, not limited to this exact vocabulary. For example,
`TRANSFORMATIONS`, `CASE STUDIES`, and `SUCCESS STORIES` belong to the Proof
group even though they are not literal entries in the table.

Highlight titles only add evidence. Missing Highlights, unavailable Highlight
data, or unfamiliar titles never cause rejection. A title such as `RESULTS`
supports proof intent, but it does not earn the maximum proof score without
additional supporting content in the bio, posts, landing page, or the
Highlight itself.

Suggested scoring treatment:

- One Proof Highlight supports a 0.5 increase in proof and maturity, capped at
  1.5 unless outcome evidence is also visible.
- One Offer Highlight supports a 0.5 increase in offer evidence, capped at 1.5
  unless the offer itself is described.
- One Funnel Highlight supports a 0.5 increase in conversion intent, capped at
  1.5 unless a direct action is visible.
- Authority Highlights provide supporting context but do not independently
  raise a commercial dimension.
- Two or more distinct commercial groups provide a profile-funnel maturity
  flag used as supporting evidence and as a priority tie-breaker.

The current system does not store Story Highlight titles. Supporting this
signal requires adding a nullable `story_highlight_titles` collection and its
capture timestamp to the backfill result. A null collection means not captured;
an empty collection means captured and none were visible. These states must not
be conflated.

## Step 2: Validate metadata quality

Before filtering or scoring, classify the input as `complete`, `partial`, or
`unreliable`.

### Complete

The profile has a usable bio, follower count, and either recent posts or a
confirmed total-post count of zero.

### Partial

The profile has enough bio and profile evidence for commercial scoring, but
post metrics, views, timestamps, or captions are incomplete. Commercial
scoring proceeds. Activity is recorded as unknown and does not reduce the
commercial score.

### Unreliable

The account reports existing posts but the scraper returned no post sample, or
the core profile fields conflict or are missing. The lead enters a backfill
retry or data-quality queue. It must not be rejected as inactive.

The retry policy should attempt the standard provider and then the configured
fallback. After the retry budget is exhausted, the lead can still receive a
bio-only commercial score if the bio contains enough evidence. Its activity
priority remains unknown.

## Step 3: Apply universal exclusions

Universal exclusions are deterministic and happen before AI classification.
Only reliable, ICP-independent disqualifiers belong here.

Reject when any of the following is confirmed:

- The profile is private and there is not enough public evidence to evaluate
  an offer.
- The account is unavailable, deleted, or clearly impersonating another
  account.
- The identity is an obvious meme, fan, gossip, news, parody, or repost page.
- The bio and identity contain a configured exclusion term with clear semantic
  relevance.
- The profile is a non-commercial personal account with no expertise,
  audience, transformation, offer, CTA, or business evidence.

Follower count is not a universal hard exclusion. The configured follower
range contributes to priority and can flag a lead for review, but it should not
erase strong commercial evidence. Include keywords are positive evidence, not
a mandatory hard gate. Failure to match an exact keyword never causes an
automatic rejection.

Each exclusion stores a normalized reason and the exact evidence that caused
it. A keyword match alone is insufficient when the surrounding context changes
its meaning.

## Step 4: Classify the commercial track

The AI assigns one primary track:

- `infopreneur`: coach, consultant, educator, expert, creator with a paid
  transformation, course, mentorship, community, or private instruction.
- `partnership`: agency, service provider, software operator, media operator,
  or complementary business that can create partnership value.
- `commerce`: product-led business whose suitability needs a distinct review
  rule.
- `non_commercial`: creator or personal account without meaningful buying or
  partnership intent.
- `uncertain`: insufficient or contradictory evidence.

Track classification and qualification are separate. A profile can clearly be
an infopreneur while still lacking enough buyer, offer, or proof evidence to
qualify.

`uncertain` profiles cannot be automatically rejected when credible commercial
signals exist. They enter manual review.

## Step 5: Score commercial fit

Score five dimensions from 0 to 2 in increments of 0.5. Each dimension must
include a short evidence citation copied or paraphrased from the profile.

### Buyer clarity

| Score | Definition |
|---:|---|
| 0 | No identifiable buyer or audience |
| 0.5 | Broad audience implied only by content topic |
| 1 | Buyer category is reasonably inferable |
| 1.5 | A specific buyer is visible but incompletely defined |
| 2 | The target buyer is explicitly named and commercially relevant |

Examples include coaches, consultants, service providers, ambitious men,
Christian men, founders, and language learners.

### Transformation clarity

| Score | Definition |
|---:|---|
| 0 | No result or problem is identifiable |
| 0.5 | General inspiration or lifestyle improvement |
| 1 | Expertise is clear but the outcome is vague |
| 1.5 | A meaningful result is strongly implied |
| 2 | A specific transformation or business outcome is explicit |

Examples include acquiring premium clients, scaling a personal brand, losing
fat, building muscle, improving confidence, or learning a language.

### Offer evidence

| Score | Definition |
|---:|---|
| 0 | No evidence of a product or service |
| 0.5 | Monetization is possible but unsupported |
| 1 | Commercial activity or a business is implied |
| 1.5 | A service, program, course, agency, or coaching offer is visible |
| 2 | A concrete paid offer and delivery model are explicit |

### Conversion intent

| Score | Definition |
|---:|---|
| 0 | No commercial next step |
| 0.5 | Generic link with unknown purpose |
| 1 | Broad invitation to follow, learn, or visit a site |
| 1.5 | A relevant lead magnet or commercially suggestive CTA |
| 2 | Direct instruction to DM, comment, apply, book, join, or request help |

### Proof and operating maturity

| Score | Definition |
|---:|---|
| 0 | No proof or authority evidence |
| 0.5 | Expertise is claimed without supporting evidence |
| 1 | Credible specialization, personal transformation, or operating history |
| 1.5 | Testimonials, results, a named method, or meaningful audience authority |
| 2 | Strong quantified results, client wins, recognized authority, or repeated proof |

Proof-oriented Story Highlights such as `RESULTS`, `CLIENTS`, `REVIEWS`,
`WINS`, and `TESTIMONIALS` count as supporting evidence under the caps defined
in Step 1. Offer and funnel Highlights support their corresponding dimensions.
They do not create a separate sixth dimension because that would count the same
commercial evidence twice.

The commercial-fit score is the sum of these five dimensions and ranges from
0 to 10.

## Step 6: Make the qualification decision

### Qualified

Automatically qualify when all conditions hold:

- Commercial-fit score is at least 8.0.
- Offer evidence is at least 1.0.
- At least one of buyer clarity or transformation clarity is at least 1.5.
- The track is `infopreneur` or `partnership`.
- No universal exclusion applies.

### Manual review

Send to review when any condition holds:

- Commercial-fit score is 6.0 to 7.5.
- Commercial-fit score is at least 8.0 but a required dimension is missing.
- The track is `uncertain` or `commerce` and credible commercial signals exist.
- The AI confidence is below 0.75.
- Evidence is contradictory, such as a strong CTA with no identifiable offer.
- A follower-range flag applies to an otherwise strong lead.

### Rejected

Reject when either condition holds:

- A reliable universal exclusion applies.
- Commercial-fit score is at most 5.5 and AI confidence is at least 0.75.

Low-confidence low scores enter review instead of rejection. Every rejected
lead stores both the normalized reason and the commercial dimension scores.

## Step 7: Calculate activity and reach separately

Activity does not change the commercial qualification decision. It produces a
separate 0 to 10 priority score used to order review, enrichment, and outreach.

### Preferred metrics

When at least three unpinned Reels have valid view counts, calculate:

```text
reel_view_rate = median unpinned Reel views / followers
```

Use the median rather than the mean to reduce the effect of one viral post.
When fewer than three valid Reel view counts exist, mark Reel reach as unknown.

Also calculate:

- Posts in the last 30 days.
- Reels in the last 30 days.
- Days since the most recent captured post.
- Median likes per follower as a secondary signal only.
- Median comments per 1,000 views when both values exist.

### Priority components

| Component | Weight |
|---|---:|
| Commercial-fit score | 50% |
| Proof and maturity | 15% |
| Reel view rate | 15% |
| Posting recency | 10% |
| Posting consistency | 10% |

Unknown activity metrics contribute no negative penalty. The priority score
must expose a data-completeness indicator so unknown activity is not confused
with poor activity.

Likes must never independently reject a lead. A profile with low follower-like
engagement can remain high priority when it has healthy view reach and strong
commercial evidence.

## Step 8: Produce a structured AI response

The classifier returns a versioned object with this logical shape:

```json
{
  "model_version": "commercial-fit-v1",
  "track": "infopreneur",
  "confidence": 0.91,
  "scores": {
    "buyer_clarity": 2,
    "transformation_clarity": 2,
    "offer_evidence": 2,
    "conversion_intent": 2,
    "proof_maturity": 1.5,
    "commercial_fit": 9.5
  },
  "evidence": {
    "buyer": "I help high ticket coaches and service providers",
    "transformation": "scale",
    "offer": "results-based client acquisition service",
    "conversion": "DM SCALE",
    "proof": "$4M in sales before 30",
    "story_highlights": ["RESULTS", "CLIENTS", "START HERE"]
  },
  "data_quality": "complete",
  "decision": "qualified",
  "decision_reason": "Clear buyer, transformation, offer, CTA, and quantified proof",
  "review_flags": []
}
```

The backend validates ranges, required fields, permitted enum values, score
totals, and decision rules. Invalid AI output is retried once. A second invalid
response enters a scoring-error queue rather than being treated as rejection.

## Step 9: Manual review

The review queue sorts by commercial-fit score, then confidence, then priority
score. The reviewer sees:

- Bio, display name, external link, and recent content preview.
- The five dimension scores and supporting evidence.
- Captured Story Highlight titles grouped as Proof, Offer, Funnel, and
  Authority signals.
- Data-quality state and missing metrics.
- AI decision and confidence.
- Any follower, track, or contradictory-evidence flags.

Reviewer actions are `approve`, `reject`, and `defer`. Reject requires a
normalized reason. Reviewer changes are stored separately from the AI result
so model accuracy can be measured without overwriting the original prediction.

High-confidence profiles with commercial fit of at least 9.0 may be eligible
for auto-approval after the validation period demonstrates acceptable
precision. Auto-approval is not part of the initial rollout.

## Step 10: Enrichment handoff

A lead is ready for enrichment when:

- Qualification decision is `qualified`.
- Manual decision is `approved`, unless a future validated auto-approval rule
  applies.
- No email is already available.
- The lead is not currently assigned to an open enrichment batch.
- The lead has not exceeded the configured enrichment retry limit.

A closed batch must not strand a lead forever. A lead returned without an email
becomes retryable according to its attempt count and cooldown. Batch history is
stored separately from current eligibility.

## Historical reprocessing

Existing rejected profiles should not all be restored at once. Reprocess them
in controlled cohorts, beginning with rejection rules most likely to contain
false negatives under this specification:

1. `no_recent_posts`
2. `engagement_below_min`
3. `reels_30d_below_min`
4. `no_include_keyword_match`
5. `followers_below_min` and `followers_above_max`

Each cohort records its old decision, new decision, reviewer verdict, and
eventual enrichment and outreach outcomes.

## Validation and rollout

### Benchmark set

Create a versioned labeled set containing:

- The eight user-supplied very-qualified profiles as positive examples.
- At least 50 additional manually approved qualified leads.
- At least 100 manually confirmed bad leads covering each major rejection
  reason.
- Borderline cases that previously caused reviewer disagreement.

No profile used to tune prompt wording or thresholds should be counted as an
independent final evaluation example.

### Offline acceptance criteria

- All eight supplied positive examples classify as qualified or manual review,
  never automatic rejection.
- Precision on automatic qualification is at least 90% against reviewer labels.
- Recall on confirmed qualified leads improves relative to the current
  production classifier.
- No profile is rejected solely because likes, views, or post data are missing.
- Story Highlights can strengthen offer, conversion, and proof evidence, but
  missing Highlight data never lowers a score or causes rejection.
- The same stored evidence produces the same deterministic threshold decision.
- Every decision exposes dimension scores, evidence, confidence, and model
  version.

### Shadow rollout

Run the new classifier alongside the existing system without changing lead
status. Compare both decisions against manual review for at least 200 profiles.
Report disagreement by reason, track, seed, follower band, and data-quality
state.

### Production rollout

After shadow acceptance:

1. Use the new classifier for new leads while preserving the old result fields.
2. Keep all borderline decisions in manual review.
3. Monitor qualification rate, reviewer approval rate, enrichment success, and
   positive outreach response by model version.
4. Reprocess historical cohorts gradually.
5. Roll back by model version if automatic qualification precision falls below
   the accepted threshold.

## Success metrics

The change succeeds when it improves business outcomes rather than merely
increasing the qualified count. Track:

- Percentage of backfilled profiles reaching AI classification.
- Automatic qualification precision.
- Qualified-lead recall on reviewer-confirmed examples.
- Manual-review approval rate.
- Median time from backfill to review decision.
- Percentage of qualified leads ready for enrichment.
- Email discovery rate by commercial-fit band.
- Positive reply and meeting-booked rate by commercial-fit band.
- Rejection and approval rates by source seed.
- Percentage of decisions with complete stored evidence.

## Out of scope

- Automatically changing current production settings before shadow validation.
- Rebuilding the Instagram scraper.
- Defining outreach copy or campaign segmentation.
- Treating follower count, likes, or views as a direct proxy for purchasing
  power.
- Auto-approving leads before reviewer-labeled precision is established.
