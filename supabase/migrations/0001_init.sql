-- =============================================================================
-- 0001_init.sql — schema for the Instagram leads-scraper system
-- =============================================================================

create extension if not exists pgcrypto;

-- =============================================================================
-- app_settings  (singleton row, id=1)
-- =============================================================================
create table if not exists public.app_settings (
  id                       smallint primary key default 1,
  apify_api_key            text,
  claude_api_key           text,
  claude_model             text not null default 'claude-opus-4-7',
  scrapingbee_api_key      text,

  default_seeds            jsonb not null default '["https://www.instagram.com/pierree/"]'::jsonb,

  -- crawl
  max_crawl_depth          int  not null default 2,
  max_profiles_per_account int  not null default 100,
  crawl_score_threshold    numeric(3,1) not null default 7.5,

  -- hard filters
  min_followers            int  not null default 5000,
  max_followers            int  not null default 500000,
  min_engagement_rate      numeric(5,4) not null default 0.005, -- 0.5%
  min_posts_last_30_days   int  not null default 1,

  -- keyword filters
  include_keywords         text[] not null default '{}',
  exclude_keywords         text[] not null default '{}',

  updated_at               timestamptz not null default now(),
  constraint app_settings_singleton check (id = 1)
);

-- seed the singleton
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- =============================================================================
-- seeds
-- =============================================================================
create table if not exists public.seeds (
  id          uuid primary key default gen_random_uuid(),
  username    text unique not null,
  profile_url text not null,
  notes       text,
  created_at  timestamptz not null default now()
);

-- default seed
insert into public.seeds (username, profile_url)
values ('pierree', 'https://www.instagram.com/pierree/')
on conflict (username) do nothing;

-- =============================================================================
-- leads
-- =============================================================================
do $$ begin
  create type lead_status as enum ('qualified', 'review', 'rejected', 'pending');
exception when duplicate_object then null; end $$;

do $$ begin
  create type activity_status as enum ('very_active', 'active', 'semi_active', 'inactive');
exception when duplicate_object then null; end $$;

create table if not exists public.leads (
  id                  uuid primary key default gen_random_uuid(),
  username            text unique not null,
  full_name           text,
  profile_url         text not null,
  bio                 text,
  external_link       text,
  is_private          boolean not null default false,
  is_verified         boolean not null default false,

  followers           int,
  following           int,
  posts               int,

  avg_likes           numeric(12,2),
  avg_comments        numeric(12,2),
  avg_views           numeric(12,2),
  engagement_rate     numeric(8,6),
  posts_last_30_days  int,
  activity_status     activity_status,

  -- raw recent posts: [{ caption, likes, comments, views, taken_at }]
  recent_posts        jsonb not null default '[]'::jsonb,

  -- claude classification
  niche               text,
  business_model      text,
  offer_type          text,
  audience_type       text,

  icp_fit_score       numeric(3,1),
  traction_score      numeric(3,1),
  monetization_score  numeric(3,1),
  activity_score      numeric(3,1),
  overall_score       numeric(3,1),
  reason_for_score    text,
  recommended_action  text,

  status              lead_status not null default 'pending',
  rejection_reason    text,

  crawl_depth         int not null default 0,
  source_seed_id      uuid references public.seeds(id) on delete set null,
  parent_username     text,        -- which lead surfaced this one (for crawl path)

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists leads_status_idx          on public.leads (status);
create index if not exists leads_overall_score_idx   on public.leads (overall_score desc nulls last);
create index if not exists leads_followers_idx       on public.leads (followers);
create index if not exists leads_engagement_rate_idx on public.leads (engagement_rate);
create index if not exists leads_niche_idx           on public.leads (niche);
create index if not exists leads_source_seed_idx     on public.leads (source_seed_id);
create index if not exists leads_created_at_idx      on public.leads (created_at desc);

-- =============================================================================
-- crawl_jobs
-- =============================================================================
do $$ begin
  create type crawl_job_status as enum ('queued', 'running', 'completed', 'failed', 'cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.crawl_jobs (
  id                uuid primary key default gen_random_uuid(),
  seed_id           uuid not null references public.seeds(id) on delete cascade,
  status            crawl_job_status not null default 'queued',
  max_depth         int not null,
  current_depth     int not null default 0,
  profiles_scraped  int not null default 0,
  qualified_count   int not null default 0,
  rejected_count    int not null default 0,
  inngest_run_id    text,
  error_message     text,
  started_at        timestamptz,
  finished_at       timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists crawl_jobs_seed_idx    on public.crawl_jobs (seed_id);
create index if not exists crawl_jobs_created_idx on public.crawl_jobs (created_at desc);

-- =============================================================================
-- crawl_logs
-- =============================================================================
create table if not exists public.crawl_logs (
  id                bigserial primary key,
  crawl_job_id      uuid references public.crawl_jobs(id) on delete cascade,
  profile_username  text not null,
  parent_username   text,
  action            text not null,   -- scraped, filtered_hard, scored, qualified, recursed, rejected
  depth             int  not null default 0,
  status            text,            -- success, failure
  detail            text,
  created_at        timestamptz not null default now()
);
create index if not exists crawl_logs_job_idx      on public.crawl_logs (crawl_job_id);
create index if not exists crawl_logs_username_idx on public.crawl_logs (profile_username);
create index if not exists crawl_logs_created_idx  on public.crawl_logs (created_at desc);

-- =============================================================================
-- error_logs
-- =============================================================================
create table if not exists public.error_logs (
  id            bigserial primary key,
  context       text not null,           -- "apify.profile", "claude.score", "pipeline"
  error_message text not null,
  payload       jsonb,
  crawl_job_id  uuid references public.crawl_jobs(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists error_logs_created_idx on public.error_logs (created_at desc);
create index if not exists error_logs_context_idx on public.error_logs (context);

-- =============================================================================
-- lead_notes
-- =============================================================================
create table if not exists public.lead_notes (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads(id) on delete cascade,
  body        text not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists lead_notes_lead_idx on public.lead_notes (lead_id);

-- =============================================================================
-- updated_at trigger helper
-- =============================================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists touch_leads on public.leads;
create trigger touch_leads
  before update on public.leads
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_settings on public.app_settings;
create trigger touch_settings
  before update on public.app_settings
  for each row execute function public.touch_updated_at();
