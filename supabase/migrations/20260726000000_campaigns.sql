-- Campaign management: user-defined lead groupings layered on top of the
-- existing auto-classified category system (Partnerships/Info/Other). A
-- campaign is open-ended/user-created, so it gets its own tables rather than
-- reusing the app_settings singleton-column pattern the category templates
-- use. Sending stays manual (composer click) — these tables carry the
-- angle/sequence/assignment/stats, not a scheduler.
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  angle text,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.campaign_steps (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  step_number int not null,
  delay_days int not null default 0,
  subject_template text not null,
  body_template text not null,
  unique (campaign_id, step_number)
);

alter table public.leads
  add column if not exists campaign_id uuid references public.campaigns(id) on delete set null,
  add column if not exists campaign_step int not null default 0,
  add column if not exists last_campaign_send_at timestamptz;

alter table public.outreach_messages
  add column if not exists campaign_id uuid references public.campaigns(id) on delete set null,
  add column if not exists step_number int;

create index if not exists leads_campaign_id_idx on public.leads(campaign_id);
create index if not exists campaign_steps_campaign_id_idx on public.campaign_steps(campaign_id, step_number);
