-- Track expected denominator for the progress bar.
-- Set once we know how many fresh profiles the seed-following scrape produced.
alter table public.crawl_jobs
  add column if not exists expected_profiles int;
