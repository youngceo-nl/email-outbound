# Lead Scoring System — Current Layout

Reflects the live `app_settings` row and the code paths as of 2026-07-23. Two
sequential **gates** run before any AI cost is spent, then an **AI
classification + deterministic scoring** pass produces the final status.

```
scraped profile
      │
      ▼
┌─────────────────┐   reject → status="rejected", rejection_reason=<gate reason>
│  1. Hard filter │──────────────────────────────────────────────────────────►
└─────────────────┘
      │ pass
      ▼
┌─────────────────┐   reject → status="rejected", rejection_reason=<gate reason>
│ 2. Metrics gate │──────────────────────────────────────────────────────────►
└─────────────────┘
      │ pass
      ▼
┌───────────────────────┐
│ 3. AI classification  │  (openai/claude/gemini/groq — one call per lead)
└───────────────────────┘
      │
      ▼
┌───────────────────────┐
│ 4. Deterministic score│  (pure code, weights below)
└───────────────────────┘
      │
      ▼
   overall_score → qualified / review / rejected
```

Entry point: `inngest/functions/score-lead.ts`. Gates: `lib/pipeline/filter.ts`.
Metrics: `lib/pipeline/metrics.ts`. AI routing: `lib/scoring/score.ts`.
Deterministic scoring: `lib/scoring/compute.ts`.

---

## 1. Hard filter (`hardFilter`, pre-AI)

Cheap, deterministic rejections — runs before any API spend.

| Check | Current value | Reject reason |
|---|---|---|
| Private account | — | `private_account` |
| Follower range | **5,000 – 500,000** | `followers_below_min` / `followers_above_max` |
| Bio present, ≥5 chars | — | `no_bio` |
| Has ≥1 recent post | — | `no_recent_posts` |
| Exclude-keyword match (bio + name + username) | 7 terms: `fan, parody, meme, news, paparazzi, gossip, official army` | `excluded_keyword:<term>` |
| Include-keyword match (bio + name + username + captions + link) | **~85 terms configured** — coaching/agency/ecom/growth vocabulary (`coach`, `mastermind`, `smma`, `book a call`, `funnel`, `webinar`, `6 figure`, `content creator`, etc. — see `app_settings.include_keywords` for the full list) | `no_include_keyword_match` |
| Junk bio regex | `meme\|fan ?page\|memes\|news\|gossip\|paparazzi` | `junk_keyword_in_bio` |

## 2. Metrics gate (`metricsGate`, pre-AI)

Runs after `computeMetrics()` derives engagement/activity from `recent_posts`.

| Check | Current value | Reject reason |
|---|---|---|
| Engagement rate ≥ min | **0.5%** (avg likes ÷ followers, from up to 3 unpinned reels, else all posts) | `engagement_below_min` |
| Reels in last 30 days ≥ min | **1** — only enforced once ≥3 reels were actually scraped (`MIN_REEL_SAMPLE_FOR_RECENCY`), so an incomplete scrape never wrongly fails this | `reels_30d_below_min` |

`activity_status` (`very_active` ≥12 reels/30d, `active` ≥6, `semi_active` ≥2,
else `inactive`) is stored but does **not** gate — it only feeds the
`activity_score` below.

## 3. AI classification

Routed by `app_settings.scoring_provider` — **currently `openai`** (gpt-4o-mini).
Claude/Gemini/Groq are equivalent, selectable in Settings. Same prompt intent
across all four providers (`lib/{provider}/classify.ts`): classify against the
two ICPs in `docs/icp.md` —

- **ICP #1 — Infopreneurs/high-ticket coaches**: B2C, $50k–75k+/mo, $500+
  offer sold via sales calls, engaged audience.
- **ICP #2 — Ad/sales agencies**: B2B service agencies (media buying, funnel
  building, SMMA, lead gen) with visible client results.

Returns `niche`, `business_model` (`course\|coaching\|agency\|ecom\|saas\|creator\|unknown`),
`offer_type`, `audience_type`, `has_visible_offer`, `offer_confidence`
(`high\|medium\|low\|none`), `icp_signal` (`strong\|moderate\|weak`).

## 4. Deterministic scoring (`computeScores`)

Pure code — no AI — combines metrics + classification into 4 sub-scores,
weighted into `overall_score` (0–10):

| Sub-score | Weight | Driven by |
|---|---|---|
| **icp_fit** | **35%** | `icp_signal` (strong=9.0, moderate=5.5, weak=1.5, else 4.0) + keyword-hit boost (up to +2) + bio/caption regex boosts for sales-call CTAs (+0.5), webinar/VSL language (+0.5), revenue proof like "$50k/mo" or "7-figure" (+0.3) |
| **traction** | 25% | engagement rate, piecewise curve: ≥6%→10, ≥4%→9, ≥2.5%→8, ≥1.5%→6.5, ≥0.8%→5, ≥0.3%→3, else 1 |
| **monetization** | 25% | external link present (+2), visible offer (+3), offer confidence (+1 to +3), business_model bonus: course/coaching/agency +2, saas/ecom/creator +0.5 |
| **activity** | 15% | reels in last 30 days: ≥12→10, ≥8→8.5, ≥4→7, ≥2→5, ≥1→3, else 0 |

**Ecom override:** `business_model === "ecom"` is treated as ICP-`weak` unless
the bio link mentions a knowledge product (`mastermind\|course\|coaching\|program\|training\|bootcamp\|academy\|workshop\|masterclass`) —
ecom founders who also sell a course still qualify.

**Hard cap:** if the effective `icp_signal` is `weak`, `overall_score` is capped
at **6.5** regardless of how high traction/monetization/activity score —
wrong-industry accounts can never qualify on engagement alone.

## Recommended action / final status

```
qualified threshold = app_settings.crawl_score_threshold   (currently 0)
review threshold    = max(0, qualified_threshold - 2)       (currently 0)

overall_score >= qualified_threshold → "qualified"
overall_score >= review_threshold    → "review"
else                                 → "rejected"
```

> **⚠️ Current live config note:** `crawl_score_threshold` is set to **`0`**,
> not the schema default of `7.5`. Since `overall_score` is always clamped to
> `[0, 10]`, every lead that survives the two pre-AI gates currently comes out
> `qualified` — the AI/deterministic score is computed and stored (and still
> drives the wrong-ICP 6.5 cap and `reason_for_score` text), but it no longer
> gates `status` at all. `"review"` is effectively unreachable at this
> threshold. Worth confirming this is intentional — it means the real
> filtering happens entirely upstream, in the hard filter + metrics gate.

## Rejected → `overall_score` and sub-scores are nulled

Any `"rejected"` status (hard filter, metrics gate, or a sub-7.5-equivalent AI
score if the threshold is ever raised again) clears `icp_fit_score`,
`traction_score`, `monetization_score`, `activity_score`, `overall_score`, and
sets `rejection_reason` — so a later re-score never reads stale scores from an
earlier pass.
