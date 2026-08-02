-- Test-environment forensics for qualification runs.
--
-- Motivation: on 2026-08-01 a 600-lead CLI batch silently produced garbage. The
-- Anthropic credit balance ran out ~42 leads in and the remaining 552 extractions
-- failed with `provider_error`, each writing an all-zero score row that is
-- indistinguishable from "this lead is genuinely weak". Diagnosing it took an
-- hour of manual SQL. These tables make that visible in the app.
--
-- Two things the existing three tables cannot express:
--
-- 1. The run produces nine things (lib/qualification/run.ts, QualificationRunResult)
--    and we persist three. `sufficiency`, `challenger_trigger`, `timings_ms`, and
--    the challenger's token usage were computed and discarded — which is exactly
--    why the Opus challenger's cost stayed invisible.
--
-- 2. A lead that terminates BEFORE the AI call writes no rows at all.
--    terminalResult() returns snapshot: null for universal exclusions and
--    unscrapeable profiles, and persistResult bails on a null snapshot — so 26
--    leads from that batch left zero database trace. qualification_run_leads is
--    written for EVERY lead attempt, including those, which is what closes it.
--
-- Every column here is nullable so a backfilled row can say "not recorded"
-- rather than render a false green. run_id on the three existing tables is
-- additive and nullable: the 594 pre-existing rows stay valid, and `on delete
-- set null` means deleting a run never cascades into immutable evidence history.

create table if not exists public.qualification_runs (
  id                          uuid primary key default gen_random_uuid(),
  label                       text,
  source                      text not null default 'cli' check (source in ('cli','replay','inngest')),
  status                      text not null default 'running' check (status in ('running','completed','failed')),
  started_at                  timestamptz not null default now(),
  finished_at                 timestamptz,

  requested_count             int not null default 0,
  processed_count             int not null default 0,
  qualified_count             int not null default 0,
  review_count                int not null default 0,
  rejected_count              int not null default 0,
  data_retry_count            int not null default 0,

  -- What the run list ranks on. A run is "broken" when these dominate.
  acquisition_failed_count    int not null default 0,
  extraction_failed_count     int not null default 0,
  challenger_failed_count     int not null default 0,
  persist_failed_count        int not null default 0,
  challenger_ran_count        int not null default 0,

  -- Split by model deliberately. The extractor is Haiku ($1/$5 per MTok) and the
  -- challenger is Opus ($5/$25) — a single blended total is precisely what hid
  -- the fact that the challenger, not the extractor, was the cost driver.
  extraction_input_tokens     bigint not null default 0,
  extraction_output_tokens    bigint not null default 0,
  challenger_input_tokens     bigint not null default 0,
  challenger_output_tokens    bigint not null default 0,
  estimated_cost_usd          numeric(10,4),

  extractor_provider          text,
  extractor_model             text,
  challenger_provider         text,
  challenger_model            text,

  acquisition_version         text,
  extraction_prompt_version   text,
  challenger_prompt_version   text,
  scorecard_version           text,
  config_version              text,
  pipeline_version            text,

  concurrency                 int,
  notes                       text,
  error_message               text,
  created_at                  timestamptz not null default now()
);

create index if not exists qualification_runs_started_at_idx
  on public.qualification_runs (started_at desc);

-- One row per lead attempt. Written even when acquisition throws, sufficiency
-- terminates pre-AI, or persistence itself fails — so nothing is invisible.
create table if not exists public.qualification_run_leads (
  id                          uuid primary key default gen_random_uuid(),
  run_id                      uuid not null references public.qualification_runs(id) on delete cascade,
  lead_id                     uuid references public.leads(id) on delete set null,
  username                    text not null,
  input                       text,                 -- raw CLI argument

  status                      text not null check (status in ('ok','acquisition_failed','persist_failed','skipped')),
  error_message               text,

  -- Stage 1: which provider actually served this lead
  acquisition_source          text,
  profile_extraction_method   text,

  -- Stage 3: the pre-AI data-quality / universal-exclusion verdict
  sufficiency_verdict         text,
  sufficiency_data_quality    text,
  sufficiency_reasons         text[],
  sufficiency_exclusion_evidence text,

  -- Stage 4: extraction. `extraction_problems` is the field that would have
  -- surfaced "credit balance is too low" on day one instead of hour two.
  extraction_ok               boolean,
  extraction_provider         text,
  extraction_model            text,
  extraction_input_tokens     int,
  extraction_output_tokens    int,
  extraction_failure_reason   text,
  extraction_problems         text[],

  -- Stage 8: why the challenger fired, and what it cost
  challenger_trigger          text,
  challenger_ran              boolean,
  challenger_agrees           boolean,
  challenger_error            text,
  challenger_disagreements    text[],
  challenger_provider         text,
  challenger_model            text,
  challenger_input_tokens     int,
  challenger_output_tokens    int,

  acquisition_ms              int,
  extraction_ms               int,
  challenger_ms               int,
  total_ms                    int,
  estimated_cost_usd          numeric(10,6),

  -- Outcome projection, so the run detail table needs no joins
  decision                    text,
  mode                        text,
  track                       text,
  certainty                   text,
  commercial_fit              numeric(4,2),

  -- Links into immutable history; null when the lead terminated before them
  evidence_snapshot_id        uuid references public.lead_evidence_snapshots(id) on delete set null,
  extraction_id               uuid references public.lead_commercial_extractions(id) on delete set null,
  decision_id                 uuid references public.lead_qualification_decisions(id) on delete set null,

  created_at                  timestamptz not null default now()
);

create unique index if not exists qualification_run_leads_run_username_idx
  on public.qualification_run_leads (run_id, username);
create index if not exists qualification_run_leads_run_created_idx
  on public.qualification_run_leads (run_id, created_at);
create index if not exists qualification_run_leads_failed_extraction_idx
  on public.qualification_run_leads (run_id) where extraction_ok is false;
create index if not exists qualification_run_leads_not_ok_idx
  on public.qualification_run_leads (run_id) where status <> 'ok';

-- Additive run_id on the existing history tables. Lets run queries use
-- .eq("run_id", …) instead of .in() with several hundred UUIDs, which blows the
-- PostgREST URL length limit (the bug already fixed once in app/actions/review.ts).
alter table public.lead_evidence_snapshots
  add column if not exists run_id uuid references public.qualification_runs(id) on delete set null;
alter table public.lead_commercial_extractions
  add column if not exists run_id uuid references public.qualification_runs(id) on delete set null;
alter table public.lead_qualification_decisions
  add column if not exists run_id uuid references public.qualification_runs(id) on delete set null;

create index if not exists lead_evidence_snapshots_run_idx
  on public.lead_evidence_snapshots (run_id, created_at desc) where run_id is not null;
create index if not exists lead_commercial_extractions_run_idx
  on public.lead_commercial_extractions (run_id, created_at desc) where run_id is not null;
create index if not exists lead_qualification_decisions_run_idx
  on public.lead_qualification_decisions (run_id, created_at desc) where run_id is not null;

alter table public.qualification_runs      enable row level security;
alter table public.qualification_run_leads enable row level security;

drop policy if exists qualification_runs_all on public.qualification_runs;
create policy qualification_runs_all on public.qualification_runs
  for all to authenticated using (true) with check (true);

drop policy if exists qualification_run_leads_all on public.qualification_run_leads;
create policy qualification_run_leads_all on public.qualification_run_leads
  for all to authenticated using (true) with check (true);
