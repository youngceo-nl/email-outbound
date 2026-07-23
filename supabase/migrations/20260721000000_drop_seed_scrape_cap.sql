-- Every crawl is full-account now — there is no partial cap to store any
-- more. Scraping a seed below its full following list only ever meant
-- re-walking (and re-billing Apify for) the same accounts on a later
-- full-account run, since there was never a resume cursor: see
-- lib/apify/actors.ts, which has no offset/skip parameter at all.
alter table public.seeds
  drop column if exists max_profiles_to_scrape,
  drop column if exists scrape_full_following;
