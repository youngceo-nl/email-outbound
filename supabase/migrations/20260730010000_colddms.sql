-- Credentials for the "Auto IG Scraper" following-list provider
-- (lib/instagram/colddms-scraper.ts) — an alternative to Apify that drives a
-- ColdDMS (app.colddms.com) account's own scrape-and-download flow via a
-- headless browser, rather than calling Instagram's API directly.
alter table public.app_settings
  add column if not exists colddms_email text,
  add column if not exists colddms_password text;
