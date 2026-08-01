-- Evidence-first commercial qualification: persistence layer (gap 2,
-- docs/gaps.md / docs/superpowers/plans/2026-07-31-commercial-lead-qualification-implementation.md
-- Task 2). Until now lib/qualification/* only ran through scripts/qualify-profiles.ts,
-- which writes nothing to the database — every decision lived only in memory
-- for the duration of one CLI run. This adds durable, replayable storage for
-- evidence snapshots, AI extractions, and final decisions, matching the
-- shapes in lib/qualification/types.ts (EvidenceSnapshot, ExtractionResult,
-- CommercialDecision).
--
-- Rows in the three history tables are immutable — a re-run always inserts a
-- new row, never updates one. Only the `leads` projection columns get
-- updated in place, so a lead always points at its latest decision while the
-- full history stays queryable for replay/audit.
--
-- Legacy scoring columns on `leads` (score, review_decision, etc.) are left
-- untouched — this pipeline runs alongside the legacy one in shadow mode
-- until Task 13's cutover, not instead of it.

create table if not exists public.lead_evidence_snapshots (
  id                      uuid primary key default gen_random_uuid(),
  lead_id                 uuid references public.leads(id) on delete cascade,
  username                text not null,
  captured_at             timestamptz not null,
  acquisition_stop_reason text,
  acquisition_sufficiency text,
  acquisition_version     text,
  payload                 jsonb not null,  -- full EvidenceSnapshot (lib/qualification/types.ts)
  created_at              timestamptz not null default now()
);

create index if not exists lead_evidence_snapshots_lead_id_idx
  on public.lead_evidence_snapshots (lead_id, created_at desc);
create index if not exists lead_evidence_snapshots_username_idx
  on public.lead_evidence_snapshots (username, created_at desc);

create table if not exists public.lead_commercial_extractions (
  id                        uuid primary key default gen_random_uuid(),
  evidence_snapshot_id      uuid not null references public.lead_evidence_snapshots(id) on delete cascade,
  lead_id                   uuid references public.leads(id) on delete cascade,  -- denormalized for direct lookup
  extraction_prompt_version text,
  provider                  text,
  model                     text,
  ok                        boolean not null,             -- extraction succeeded vs. malformed/invalid output
  input_tokens              int,
  output_tokens             int,
  payload                   jsonb not null,  -- full ExtractionResult (success or failure variant)
  created_at                timestamptz not null default now()
);

create index if not exists lead_commercial_extractions_snapshot_idx
  on public.lead_commercial_extractions (evidence_snapshot_id, created_at desc);
create index if not exists lead_commercial_extractions_lead_id_idx
  on public.lead_commercial_extractions (lead_id, created_at desc);

create table if not exists public.lead_qualification_decisions (
  id                          uuid primary key default gen_random_uuid(),
  lead_id                     uuid references public.leads(id) on delete cascade,
  evidence_snapshot_id        uuid not null references public.lead_evidence_snapshots(id) on delete cascade,
  extraction_id               uuid references public.lead_commercial_extractions(id) on delete set null,
  scorecard_version           text not null,
  pipeline_version            text,

  track                       text not null,
  icp_eligible                boolean not null,
  hard_exclusion              boolean not null default false,
  rejection_reason            text,

  commercial_fit              numeric(4,2),
  certainty                   text check (certainty in ('high','medium','low')),
  challenger_agreement        boolean,

  decision                    text not null check (decision in ('qualified','review','rejected','data_retry')),
  mode                        text not null check (mode in ('auto_approved','manual_review','hard_excluded','retry_required')),
  automatic_approval_eligible boolean not null default false,
  decision_reasons            text[] not null default '{}',
  review_flags                text[] not null default '{}',

  priority_score              numeric(4,2),
  payload                     jsonb not null,  -- full CommercialDecision (lib/qualification/types.ts)
  decided_at                  timestamptz not null,
  created_at                  timestamptz not null default now()
);

create index if not exists lead_qualification_decisions_lead_id_idx
  on public.lead_qualification_decisions (lead_id, created_at desc);
create index if not exists lead_qualification_decisions_review_idx
  on public.lead_qualification_decisions (mode, decision) where mode = 'manual_review';

create table if not exists public.lead_qualification_configs (
  id           uuid primary key default gen_random_uuid(),
  version      text not null unique,
  is_active    boolean not null default false,
  scorecard    jsonb not null,  -- Scorecard (lib/qualification/scorecard.ts) — thresholds, label-to-point maps
  notes        text,
  created_at   timestamptz not null default now()
);

create unique index if not exists lead_qualification_configs_one_active_idx
  on public.lead_qualification_configs ((true)) where is_active;

alter table public.lead_evidence_snapshots      enable row level security;
alter table public.lead_commercial_extractions  enable row level security;
alter table public.lead_qualification_decisions enable row level security;
alter table public.lead_qualification_configs   enable row level security;

drop policy if exists lead_evidence_snapshots_all on public.lead_evidence_snapshots;
create policy lead_evidence_snapshots_all on public.lead_evidence_snapshots
  for all to authenticated using (true) with check (true);

drop policy if exists lead_commercial_extractions_all on public.lead_commercial_extractions;
create policy lead_commercial_extractions_all on public.lead_commercial_extractions
  for all to authenticated using (true) with check (true);

drop policy if exists lead_qualification_decisions_all on public.lead_qualification_decisions;
create policy lead_qualification_decisions_all on public.lead_qualification_decisions
  for all to authenticated using (true) with check (true);

drop policy if exists lead_qualification_configs_all on public.lead_qualification_configs;
create policy lead_qualification_configs_all on public.lead_qualification_configs
  for all to authenticated using (true) with check (true);

-- Operational projection columns on `leads` — nullable, additive, no effect on
-- existing rows or the legacy pipeline. Populated only by the new orchestrator
-- (Task 10), which does not exist yet, so these stay null until then.
alter table public.leads
  add column if not exists qualification_state         text,   -- 'pending' | 'processing' | 'done' | 'error'
  add column if not exists qualification_outcome        text,   -- mirrors lead_qualification_decisions.decision
  add column if not exists qualification_decision_id     uuid references public.lead_qualification_decisions(id) on delete set null,
  add column if not exists qualification_ready_at        timestamptz,
  add column if not exists qualification_review_reason   text,
  add column if not exists qualification_pipeline_version text,
  add column if not exists approval_source                text check (approval_source in ('automatic','manual'));

create index if not exists leads_qualification_outcome_idx
  on public.leads (qualification_outcome) where qualification_outcome is not null;
