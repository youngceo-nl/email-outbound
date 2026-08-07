-- Remove ScrapingBee. Steel + Playwright is the acquisition backend
-- (lib/instagram/steel-acquisition.ts) and link-in-bio enrichment is a plain
-- HTTP fetch, so nothing reads these settings any more.
--
-- Safe to run more than once. Nothing here touches usage_events: rows logged
-- with provider = 'scrapingbee' are historical spend and stay readable.

alter table public.app_settings
  drop column if exists scrapingbee_api_key;

alter table public.app_settings
  drop column if exists scrapingbee_api_keys;

-- 'scrapingbee' stopped being a code path in 20260719020000_apify_standard.sql,
-- which also moved every row off it and made 'apify' the default. This just
-- stops the value being accepted at all.
alter table public.app_settings
  drop constraint if exists app_settings_following_scraper_provider_check;

alter table public.app_settings
  add constraint app_settings_following_scraper_provider_check
    check (following_scraper_provider in ('apify','cookie','auto','colddms','hikerapi','playwright'));
