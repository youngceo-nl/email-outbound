-- Funnel enrichment: scrape the lead's external_link, identify platform, extract
-- the program/offer name. Ran automatically when a lead qualifies (if toggled on).

alter table public.leads
  add column if not exists funnel_url             text,
  add column if not exists funnel_platform        text,
  add column if not exists funnel_program_name    text,
  add column if not exists funnel_offer_summary   text,
  add column if not exists funnel_price           text,
  add column if not exists funnel_extracted_at    timestamptz,
  add column if not exists funnel_extraction_error text;

create index if not exists leads_funnel_platform_idx     on public.leads (funnel_platform);
create index if not exists leads_funnel_extracted_at_idx on public.leads (funnel_extracted_at);

alter table public.app_settings
  add column if not exists enrich_funnels_auto boolean not null default true,
  add column if not exists enrich_emails_auto  boolean not null default false;
