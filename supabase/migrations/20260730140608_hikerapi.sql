-- HikerAPI (api.hikerapi.com) — pay-per-request Instagram private-API provider.
-- New `following_scraper_provider` option, selectable per-seed alongside
-- apify/playwright/cookie/colddms. See lib/hikerapi/*, lib/pipeline/scrape-following.ts.
alter table public.app_settings
  add column if not exists hikerapi_api_key text;

alter table public.app_settings
  drop constraint if exists app_settings_following_scraper_provider_check;

alter table public.app_settings
  add constraint app_settings_following_scraper_provider_check
    check (following_scraper_provider in ('apify','scrapingbee','cookie','auto','colddms','hikerapi','playwright'));
