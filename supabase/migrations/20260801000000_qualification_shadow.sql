-- Shadow mode for the evidence-first commercial qualification pipeline
-- (lib/qualification/*, lib/evidence/*).
--
-- The new pipeline runs ALONGSIDE the live gpt-4o-mini scorer in
-- inngest/functions/score-lead.ts and writes here. It never writes to
-- public.leads and never changes a lead's status. The point is to measure the
-- new pipeline's real qualification rate and its disagreement profile against
-- the live scorer before it is allowed to decide anything.
--
-- The evidence snapshot is stored verbatim so a run can be replayed offline
-- through requalifyFromSnapshot() after a scorecard or prompt change, without
-- re-scraping. That replayability is the reason this table is worth its size.

create table if not exists public.lead_qualification_shadow (
  id                  uuid primary key default gen_random_uuid(),
  lead_id             uuid not null references public.leads(id) on delete cascade,
  username            text not null,

  -- What the NEW pipeline concluded.
  outcome             text,            -- qualified | rejected | review | data_retry | scoring_error
  decision_mode       text,            -- how it got there (hard_excluded, auto_approved, ...)
  score               numeric,
  certainty           text,            -- high | medium | low
  reason_codes        text[] not null default '{}',
  challenger_verdict  text,            -- agrees | disagrees | null when not triggered

  -- What the LIVE scorer concluded for the same lead at the same moment, copied
  -- in at write time. Comparing later against public.leads would be wrong: the
  -- lead may have been rescored or hand-edited since.
  legacy_status       text,
  legacy_score        numeric,
  -- Null when either side has no verdict to compare (e.g. a scoring error).
  agrees              boolean,

  -- Replay payloads.
  snapshot            jsonb,
  extraction          jsonb,
  decision            jsonb,
  acquisition_version text,

  timings_ms          jsonb,
  usage               jsonb,
  -- Set when the shadow run itself failed. A failure here is an infrastructure
  -- fact, never a judgement about the lead.
  error               text,

  created_at          timestamptz not null default now()
);

-- Most recent shadow verdict per lead is the common lookup.
create index if not exists lead_qualification_shadow_lead_idx
  on public.lead_qualification_shadow (lead_id, created_at desc);
-- Rate and disagreement rollups scan by time and outcome.
create index if not exists lead_qualification_shadow_created_idx
  on public.lead_qualification_shadow (created_at desc);
create index if not exists lead_qualification_shadow_outcome_idx
  on public.lead_qualification_shadow (outcome, created_at desc);
-- Disagreements are the rows a human actually reviews.
create index if not exists lead_qualification_shadow_disagree_idx
  on public.lead_qualification_shadow (created_at desc) where agrees = false;

alter table public.lead_qualification_shadow enable row level security;
drop policy if exists lead_qualification_shadow_all on public.lead_qualification_shadow;
create policy lead_qualification_shadow_all on public.lead_qualification_shadow
  for all to authenticated using (true) with check (true);

-- Shadow controls. Default OFF: deploying this migration must not start
-- spending Anthropic tokens on its own.
alter table public.app_settings
  add column if not exists shadow_qualification_enabled boolean not null default false,
  -- Percentage of scored leads to shadow-qualify, 0-100. Start low; every
  -- sampled lead costs a Haiku call plus external page fetches.
  add column if not exists shadow_qualification_sample_pct integer not null default 10;

alter table public.app_settings
  drop constraint if exists app_settings_shadow_sample_pct_check;
alter table public.app_settings
  add constraint app_settings_shadow_sample_pct_check
    check (shadow_qualification_sample_pct between 0 and 100);
