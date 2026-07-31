# Lead Qualification — How It Currently Works

Small demo covering only the **lead qualification** part (scrape → lead or
not), walked through using real, current leads from the database. Outreach,
campaigns, and replies are out of scope for this demo.

**Worth knowing before reading on**: the pipeline has genuinely changed
since earlier documentation on this — there's now a hard split between two
tracks (infopreneur vs. partnership) that only forms *after* AI
classification, and the "review" status is now dead code (can no longer
occur). Everything below was verified against the actual current code, not
recalled from memory.

---

## Step 1 — Hard filter (before classification, applies to everyone)

`lib/pipeline/filter.ts`'s `hardFilter()` — purely deterministic, no AI,
runs before anything gets classified. Checks:

- not private
- followers between **5,000 and 500,000** (current setting)
- bio present, ≥5 characters
- no exclude-keyword in bio/name/username
- must contain ≥1 include-keyword (bio, name, username, captions, or bio link)
- no "junk" bio (meme/fan page/news/etc.)

**Example reject** — `kingturf_miami` (2,605 followers):
> `rejection_reason: "followers_below_min (2605 < 5000)"`

Anything that fails here goes straight to `status: rejected` — never
classified, so no AI spend wasted.

---

## Step 2 — AI classification (before the activity gate!)

Whatever survives the hard filter goes through `lib/scoring/score.ts` to the
configured AI provider (currently: **OpenAI**, `gpt-4o-mini`). This produces:
`niche`, `business_model`, `offer_type`, `audience_type`, `icp_signal`
(strong/moderate/weak), `has_visible_offer`, `offer_confidence`.

**Why classification happens before the activity check**: only after this
does the system know whether a lead is an *infopreneur*
(coaching/course/ecom/saas/creator) or a *partnership* lead
(`business_model = "agency"`) — and that decides which gate applies next.

---

## Step 3 — Track routing

`lib/leads/category.ts`'s `leadTrackFor(business_model)`:

```
business_model === "agency"  →  partnership track
anything else                →  infopreneur track
```

The two tracks **diverge** from here:

### Partnership track
No activity gate, no score threshold — a partnership lead always becomes
`status: "qualified"` immediately and goes into a manual review queue (the
Partnerships track on the Review tab). The score still gets computed and
stored (for context), but it doesn't decide whether the lead passes.

### Infopreneur track (rest of this demo)
Still has to pass the activity gate (step 4) and the score threshold (step 6).

---

## Step 4 — Infopreneur gate (`infopreneurGate`, infopreneur track only)

- must have ≥1 recent post
- engagement rate ≥ **0.5%**
- ≥**1** reel in the last 30 days (only enforced once ≥3 reels are already
  known — otherwise there's too little data to judge fairly)

Partnership leads skip this entire block.

---

## Step 5 — Deterministic score (for whoever survives step 4)

`lib/scoring/compute.ts` — no AI at this point, pure arithmetic from the
classification + metrics. Four sub-scores, with these weights:

| Sub-score | Weight | Driven by |
|---|---|---|
| **icp_fit** | **35%** | AI's icp_signal (strong=9.0 base, moderate=5.5, weak=1.5) + keyword/bio boosts |
| monetization | 25% | bio link present, visible offer, offer_confidence, business_model |
| traction | 25% | engagement rate, piecewise curve |
| activity | 15% | number of reels in the last 30 days |

**Important rule**: if the ICP fit is `weak` (wrong industry — physical-
product ecom, B2B SaaS, service business, pure creator), the score is
**hard-capped at 3.0** and automatically rejected, regardless of engagement
or monetization. (This used to be a 6.5 cap — lowered after too many
wrong-industry leads were slipping through once the threshold dropped to 5.5.)

### Live example — `holler.academy` (164,380 followers, content coaching)

```
icp_fit:      10.0   (icp_signal: strong)
traction:      5.0   (engagement rate 1.33%)
monetization: 10.0   (visible offer, high confidence, coaching)
activity:      0.0   (0 reels in the last 30 days)

overall = 10.0×0.35 + 5.0×0.25 + 10.0×0.25 + 0.0×0.15
        = 3.5 + 1.25 + 2.5 + 0.0
        = 7.25 → rounds to 7.3
```

Notice how a **strong ICP fit + monetization** can carry a score even with
**activity_score = 0** — exactly why icp_fit carries the heaviest weight.

---

## Step 6 — Final status (infopreneur track)

```
crawl_score_threshold (current setting) = 5.5

overall_score >= 5.5  →  status: qualified
overall_score <  5.5  →  status: rejected
```

`holler.academy`: 7.3 ≥ 5.5 → **qualified**.

**No "review" status possible anymore** — the old 3-way split
(qualified/review/rejected) has been removed from the scoring code; it's
purely binary now. The 14 leads still sitting at `status = review` in the
database all predate this change (the most recent from 2026-07-25) — dead,
no longer reachable through this path.

### Contrast — a real weak-ICP reject

`ncdyerart` (33,007 followers, comic art, business_model: creator):
```
icp_fit: 1.5 (weak) → Capped at 3.0 → Overall 3.0 → reject
```
Regardless of the other sub-scores (traction was actually 8.0 here) — weak
ICP always wins.

---

## Current settings summary

| Setting | Value |
|---|---|
| min/max followers | 5,000 – 500,000 |
| min engagement rate | 0.5% |
| min reels (last 30 days) | 1 |
| qualification threshold (`crawl_score_threshold`) | **5.5** |
| weak-ICP score cap | **3.0** |
| AI provider | OpenAI (gpt-4o-mini) |
| icp_fit / monetization / traction / activity weight | 35% / 25% / 25% / 15% |

Every example above is a real, current row from the database (checked on
2026-07-28), not made up.
