-- Prospect photo, for the cover of a generated opportunity report.
--
-- The scrapers have always returned this field (lib/apify/actors.ts,
-- lib/instagram/direct.ts, lib/instagram/playwright-scraper.ts) — ensureProfileFields
-- in lib/pipeline/normalize.ts was silently dropping it because nothing consumed it.
--
-- What is stored is an Instagram CDN URL, which is signed and expires within days.
-- It is therefore a pointer for a fresh fetch at report-generation time, not a
-- durable asset: anything that needs the image resolves the bytes then and falls
-- back to a monogram if the link has gone stale. See
-- lib/report/renderer/prospect-image.ts. Storing the bytes for every scraped lead
-- was rejected deliberately — the crawl handles thousands of profiles and only a
-- handful ever get a report.
alter table public.leads
  add column if not exists profile_pic_url text;
