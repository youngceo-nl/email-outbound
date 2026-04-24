alter table public.leads
  add column if not exists linkedin_url           text,
  add column if not exists linkedin_lookup_error  text;

create index if not exists leads_linkedin_url_idx on public.leads (linkedin_url);
