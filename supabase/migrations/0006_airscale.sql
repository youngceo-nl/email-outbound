-- AirScale enrichment: add email-finder columns to leads + API key to app_settings.

alter table public.app_settings
  add column if not exists airscale_api_key text;

alter table public.leads
  add column if not exists email             text,
  add column if not exists email_status      text,
  add column if not exists email_provider    text,
  add column if not exists email_verifier    text,
  add column if not exists enriched_at       timestamptz,
  add column if not exists enrichment_error  text;

create index if not exists leads_enriched_at_idx on public.leads (enriched_at);
