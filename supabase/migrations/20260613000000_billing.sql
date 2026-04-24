-- Billing: track real spend to run the tool.
--
-- Two pieces:
--   1. api_usage_events  — one row per paid API call (LLM token usage, AirScale
--      lookups, …) with the computed USD cost. This is the "metered" spend.
--   2. fixed_costs       — editable recurring monthly subscriptions that have no
--      per-call signal (e.g. Supabase Pro at $25/mo).
--
-- The Billing tab sums metered events for the current month, adds the live
-- provider balances we can read (Apify) and the fixed subscriptions, and
-- projects the month-end total.

create table if not exists public.api_usage_events (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null,                       -- openai | claude | airscale | scrapingbee | apify
  model         text,                                -- e.g. gpt-4o-mini, claude-opus-4-7 (null for non-LLM)
  operation     text not null,                       -- funnel_extract | email_lookup | …
  lead_id       uuid references public.leads(id) on delete set null,
  quantity      numeric,                             -- units for unit-priced calls (e.g. 1 lookup)
  input_tokens  integer,
  output_tokens integer,
  cost_usd      numeric(12,6) not null default 0,
  estimated     boolean not null default false,      -- true when cost is a rate estimate, not a billed figure
  created_at    timestamptz not null default now()
);

create index if not exists api_usage_events_created_idx  on public.api_usage_events (created_at desc);
create index if not exists api_usage_events_provider_idx on public.api_usage_events (provider, created_at desc);
create index if not exists api_usage_events_lead_idx     on public.api_usage_events (lead_id);

alter table public.api_usage_events enable row level security;
drop policy if exists api_usage_events_all on public.api_usage_events;
create policy api_usage_events_all on public.api_usage_events
  for all to authenticated using (true) with check (true);

create table if not exists public.fixed_costs (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  monthly_usd numeric(10,2) not null default 0,
  note        text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.fixed_costs enable row level security;
drop policy if exists fixed_costs_all on public.fixed_costs;
create policy fixed_costs_all on public.fixed_costs
  for all to authenticated using (true) with check (true);

-- Seed the known fixed subscription. Guarded so re-running the migration is a no-op.
insert into public.fixed_costs (label, monthly_usd, note)
select 'Supabase', 25.00, 'Pro plan'
where not exists (select 1 from public.fixed_costs where label = 'Supabase');
