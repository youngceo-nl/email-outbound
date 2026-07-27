-- Campaign type (required) + A/B copy variants. A campaign now MUST declare
-- which lead track it targets (reusing the existing infopreneur/partnership
-- vocabulary from leads.lead_type, not a new naming scheme), and its sequence
-- moves under one or more variants so leads can be split-tested by percentage.
-- A lead is bucketed into exactly one variant at assignment time and stays
-- there for its whole run through the campaign.
alter table public.campaigns
  add column if not exists campaign_type text check (campaign_type in ('infopreneur', 'partnership'));

-- Backfill: the one campaign that existed before this migration ("Info") is
-- unambiguously infopreneur-targeted by name.
update public.campaigns set campaign_type = 'infopreneur' where campaign_type is null;

alter table public.campaigns alter column campaign_type set not null;

create table public.campaign_variants (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  label text not null,
  weight_pct int not null check (weight_pct > 0 and weight_pct <= 100)
);

-- Give every pre-existing campaign a default single variant at 100% so its
-- (currently empty) step list has somewhere to attach.
insert into public.campaign_variants (campaign_id, label, weight_pct)
select id, 'A', 100 from public.campaigns
where not exists (select 1 from public.campaign_variants v where v.campaign_id = campaigns.id);

-- campaign_steps now belongs to a variant, not the campaign directly.
alter table public.campaign_steps add column if not exists variant_id uuid references public.campaign_variants(id) on delete cascade;

update public.campaign_steps s
set variant_id = v.id
from public.campaign_variants v
where s.variant_id is null and v.campaign_id = s.campaign_id;

alter table public.campaign_steps alter column variant_id set not null;
alter table public.campaign_steps drop constraint if exists campaign_steps_campaign_id_step_number_key;
alter table public.campaign_steps drop column if exists campaign_id;
alter table public.campaign_steps add constraint campaign_steps_variant_step_key unique (variant_id, step_number);

alter table public.leads
  add column if not exists campaign_variant_id uuid references public.campaign_variants(id) on delete set null;

alter table public.outreach_messages
  add column if not exists campaign_variant_id uuid references public.campaign_variants(id) on delete set null;

create index if not exists campaign_variants_campaign_id_idx on public.campaign_variants(campaign_id);
