# Email Outbound

Automated Instagram lead discovery, scraping, scoring, and management.
Crawls a seed account → who they follow → recursively into qualified leads → scored by Claude.

## Stack
Next.js 15 (App Router) · Tailwind · shadcn/ui · Supabase (Postgres + Auth + RLS) · Apify · Steel + Playwright · Claude · Inngest

## Setup

```bash
pnpm install            # or npm install
cp .env.local.example .env.local   # then fill it in
```

Create the Supabase database:

```bash
# In your Supabase project SQL editor, run in order:
#   supabase/migrations/0001_init.sql
#   supabase/migrations/0002_rls.sql
#   ...then the rest of supabase/migrations/ in filename order
# OR with the supabase CLI:
supabase db push
```

Run the dev servers (two terminals):

```bash
# terminal 1
pnpm dev

# terminal 2 — Inngest local dev runner (handles the crawl jobs)
pnpm inngest:dev
```

Open http://localhost:3000, sign up, then go to Settings to fill in your Apify token and Claude key. Add a seed on the Seeds page and click "Start crawl".

## Provider strategy

Following-list scraping (`following_scraper_provider` in Settings):

| Setting | Behavior |
|---|---|
| `auto` (default) | Apify → Playwright → cookie, in that order. |
| `apify` | Apify only. |
| `hikerapi` | HikerAPI only. Pay-per-request; needs a funded balance. |
| `cookie` | Free direct fetch with your own session cookie. Caps out around 250 accounts. |

Profile acquisition is Steel + Playwright (`lib/instagram/steel-acquisition.ts`).
Link-in-bio enrichment is a plain HTTP fetch — there is no rendering fallback, so
a landing page that ships its offer only after JavaScript reads as thin.

## How a crawl flows

1. User clicks **Start crawl** on a seed → POST `/api/crawl/start` (or `startCrawl` server action) inserts a `crawl_jobs` row and sends `crawl/seed.requested` to Inngest.
2. **`crawl-seed`** function scrapes the seed's *following* list, dedupes against the `leads` table, fans out one `crawl/profile.discovered` event per fresh username.
3. **`process-profile`** function (concurrency-limited) per profile:
   - Apify scrapes profile + last 12 posts
   - Hard filter (followers range, has bio, has recent posts, keyword filters)
   - Compute metrics (avg likes / engagement rate / posts in 30d / activity status)
   - Metrics gate (engagement + posting frequency)
   - Claude scores → strict JSON (5 sub-scores, niche, business model, recommended action)
   - Upsert into `leads` with status `qualified | review | rejected`
   - Append `crawl_logs` row
   - If `overall_score >= crawl_score_threshold` AND `depth < max_crawl_depth` → emit `crawl/recurse.requested`
4. **`recurse-following`** scrapes that lead's following list and fans out at `depth+1`.

## Database

| Table | Purpose |
|---|---|
| `app_settings` | Singleton row with all runtime config (API keys, thresholds, keyword filters). |
| `seeds` | Seed accounts the user wants to crawl from. |
| `leads` | The canonical lead record. `username` is the dedup key. Includes `recent_posts` JSONB. |
| `crawl_jobs` | One per crawl invocation; status, depth, counts. |
| `crawl_logs` | Append-only event stream per profile per action. Powers the activity feed. |
| `error_logs` | Apify timeouts, Claude JSON parse failures, etc. |
| `lead_notes` | Manual notes from the lead detail page. |

RLS: any authenticated user can read/write everything (single-tenant). The Inngest functions use the service-role key to bypass RLS.

## Files

- `lib/apify/` — Apify REST + actor input builders
- `lib/instagram/` — Steel + Playwright profile acquisition, cookie pool, direct fetch
- `lib/claude/score.ts` — strict-JSON scoring prompt
- `lib/pipeline/` — filter, metrics, dedup, persist, scrape-following with fallback
- `inngest/functions/` — `crawl-seed`, `process-profile`, `recurse-following`
- `app/(dashboard)/` — UI pages (overview, seeds, leads table, lead detail, settings, logs)
- `app/api/inngest/route.ts` — Inngest webhook
- `app/api/crawl/start/route.ts` — kick off a crawl
- `app/api/leads/export/route.ts` — CSV export

## Production notes

- Set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` from your Inngest cloud dashboard before deploying.
- Apify charges per actor run. The pipeline batches profile + post scrape per profile (2 actor calls) and uses `run-sync-get-dataset-items` so each step is one HTTP round-trip.
- Claude is called once per profile that passes the hard + metrics gates. The hard filter is your main spend control.
