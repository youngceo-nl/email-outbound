# Lead Pipeline — Current Metrics

Ground-truth reference for the "how many Apify scrapes/tokens do we need for
N leads/day" calculation. Every number below came from a live query against
production data on **2026-07-28**, not from memory or an earlier estimate —
this doc exists specifically so you can re-run the queries in "How to
re-verify" and confirm nothing here is stale.

Scope: profile discovery → qualified, emailable lead. Does not cover
campaigns/sending/inbox (see `docs/instantly-fying-outreachpage/leadpipelinetocampaign.md`
for that side).

---

## Pipeline stages & current settings

1. **Following-scrape (discovery)** — Apify following actor
   (`app_settings.following_scraper_provider = "apify"`, confirmed live —
   not falling back to Playwright/cookie). One call per seed/recursion
   account; caps at **5,000** followers per call (`FULL_ACCOUNT_TARGET` in
   `lib/pipeline/scrape-following.ts` — empirically the actor returns 0
   items above this, per that file's own comment). `max_crawl_depth = 2`,
   `max_profiles_per_account = 1000` (page size, not the bulk-mode cap).

2. **Backfill (profile actor)** — Apify profile actor
   (`APIFY_PROFILE_ACTOR`), batches of **100** usernames/call
   (`APIFY_BATCH` in `inngest/functions/backfill-metadata.ts`). Fills
   followers/bio/external_link/is_private/is_verified — **and also returns
   the last ~12 posts inline** (`latestPosts`).

   **Finding while checking this**: because the profile actor already
   returns posts inline, the separate Posts actor
   (`scrapePosts()`/`APIFY_POSTS_ACTOR`) has **zero callers anywhere in the
   live pipeline** — confirmed by grepping every `inngest/functions/*.ts`
   and `app/actions/*.ts`. It's dead code from before that inline-posts
   fix. Only two actors actually run today: following + profile.

3. **Hard filter** (`lib/pipeline/filter.ts` `hardFilter`) — private
   accounts rejected; followers must be **5,000–500,000**; bio ≥5 chars;
   ≥1 recent post; include/exclude keyword lists.

4. **Metrics gate** (`hardFilter`'s sibling `metricsGate`) — engagement
   rate ≥ **0.5%**; ≥**1** reel in the last 30 days (only enforced once ≥3
   reels have actually been sampled, so an incomplete scrape can't
   wrongly fail this).

5. **AI scoring** (`lib/scoring/*`) — 0–10 score; qualifies at
   `crawl_score_threshold = 5.5` **(current — this was `0`, i.e.
   effectively disabled, earlier in this project's history; it's since
   been raised back to a real bar)**.

6. **Email enrichment (Clay, external)** — of qualified/review leads, what
   fraction end up with a usable email. **70%, per your figure** — this is
   a manual/external Clay workflow this database can't independently
   verify going forward, so treat it as a number you supply, not one this
   doc derives.

---

## Real volume, last 30 days (ending 2026-07-28)

| Metric | Value |
|---|---|
| Leads created (candidates discovered) | **8,665** |
| → backfill-complete (followers present) | 8,434 (97.3%) |
| → also have `recent_posts` | 7,089 (84% of backfilled) |
| → backfill errors | 229 |
| → qualified + review (passed hard filter + metrics gate + AI ≥5.5) | **461 (5.32% of leads created)** |
| Following-actor calls | 33 |
| → avg candidates discovered per following-actor call | **262.6** |

All-time qualify rate (stability check): 775 / 14,588 = **5.31%** — matches
the 30-day figure closely, so the 5.32% qualify rate looks like a stable
pipeline characteristic, not a recent blip.

---

## Apify actor calls needed per day (at 70% Clay find rate)

```
overall yield = qualify rate (5.32%) × email-find rate (70%) = 3.72%
```

| Target ready leads/day | Candidates needed/day | Following-actor calls/day | Profile-actor calls/day | **Total Apify calls/day** |
|---|---|---|---|---|
| 200 | ~5,375 | ~21 | ~54 | **~75** |
| 250 | ~6,720 | ~26 | ~68 | **~94** |
| 300 | ~8,065 | ~31 | ~81 | **~112** |

- Following-actor calls = candidates/day ÷ 262.6 (real recent average — will
  vary per seed account; a 600-follower test account and a 50k-follower
  account don't yield the same count per call)
- Profile-actor calls = candidates/day ÷ 100 (`APIFY_BATCH`) — assumes
  batches fill efficiently; if the backfill job runs on whatever's queued
  rather than waiting to fill a full 100, real call count would be
  somewhat higher (more, smaller batches)
- Posts actor: **0 calls** — not used
- 7 Apify accounts currently configured for token rotation
  (`app_settings.apify_api_keys`) — per-account rate limits/quotas not
  evaluated here

---

## How to re-verify these numbers later

Every figure above came from a throwaway `.mts` script using
`createAdminClient()` (per this repo's CLAUDE.md), deleted after running.
To re-check freshness, the same shape of queries:

- Total/backfilled/qualified counts: `leads` table, filtered by
  `created_at >= now() - interval '30 days'`, counted with
  `{ count: "exact", head: true }` (never `.select("*")` without a count —
  Supabase caps unbounded selects at 1000 rows, which silently
  under-counts anything larger, as happened on the first pass of this
  analysis).
- Following-actor call count: `crawl_logs` where `action = 'scraped_following'`.
- Current settings: `app_settings` row `id = 1` — specifically
  `crawl_score_threshold`, `following_scraper_provider`, `min_followers`,
  `max_followers`, `min_engagement_rate`.
- Actor usage (following vs. profile vs. posts): grep
  `inngest/functions/*.ts` + `app/actions/*.ts` for callers of
  `scrapeFollowingDetailedWithFallback`, `scrapeProfiles`, `scrapePosts`
  (`lib/apify/actors.ts`).
