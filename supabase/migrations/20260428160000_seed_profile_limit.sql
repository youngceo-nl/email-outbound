-- Per-seed override for how many followings to scrape from the seed itself.
-- NULL = fall back to app_settings.max_profiles_per_account.
alter table public.seeds
  add column if not exists max_profiles_to_scrape int
    check (max_profiles_to_scrape is null or max_profiles_to_scrape > 0);
