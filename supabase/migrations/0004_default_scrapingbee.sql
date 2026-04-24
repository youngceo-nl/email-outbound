-- Default the scraper provider to ScrapingBee. Apify is now optional.
alter table public.app_settings
  alter column following_scraper_provider set default 'scrapingbee';

update public.app_settings
   set following_scraper_provider = 'scrapingbee'
 where id = 1;
