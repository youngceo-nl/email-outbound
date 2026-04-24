-- Add scraper provider preference + optional IG session cookie for ScrapingBee.
alter table public.app_settings
  add column if not exists following_scraper_provider text not null default 'auto'
    check (following_scraper_provider in ('apify','scrapingbee','auto')),
  add column if not exists instagram_session_cookie text;
