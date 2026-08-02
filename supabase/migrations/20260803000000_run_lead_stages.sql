-- Per-lead stage tracking, so the Test Environment can show WHERE a run is,
-- not just what it finally decided.
--
-- The production pipeline is two Inngest functions (acquire-profile →
-- qualify-lead) and neither wrote anything to qualification_run_leads. A real
-- run was observable only through crawl_logs and a leads.qualification_state
-- that never takes the value 'pending' — so "enqueued but never picked up" and
-- "never enqueued" looked identical. These columns are what make a lead's
-- current position, and therefore a jam, countable.
--
-- NOTE: 20260802000000_qualification_runs.sql only half-applied — the CREATE
-- TABLEs landed but the `alter table … add column run_id` statements at the
-- bottom did not, so lead_qualification_decisions.run_id is missing. That file
-- is idempotent; re-run it in full before this one.

-- Unlike the three history tables, a run-lead row is LIVE state: it is updated
-- as the lead advances. `stage` is where it is now; `stage_entered_at` is when
-- it got there, which is what distinguishes "working" from "stuck".
alter table public.qualification_run_leads
  add column if not exists stage             text,
  add column if not exists stage_entered_at  timestamptz,
  -- Steel's own verdict: captured | blocked | challenge | failed. A non-captured
  -- status silently ends the chain (canonical-events.ts only emits the
  -- qualification event for 'captured'), which is the biggest invisible bucket.
  add column if not exists acquisition_status text,
  -- Which provider served this lead. Steel is the production path.
  add column if not exists acquisition_provider text,
  -- Which managed Instagram identity served this lead. A quarantined account
  -- shrinks the pool silently; without this you cannot trace a run of failures
  -- back to the account that caused them.
  add column if not exists identity_label      text,
  add column if not exists steel_session_id    text;

-- The original CHECK only allowed terminal states, so a lead in flight had no
-- legal value to sit in.
alter table public.qualification_run_leads
  drop constraint if exists qualification_run_leads_status_check;
alter table public.qualification_run_leads
  add constraint qualification_run_leads_status_check
    check (status in ('queued','running','ok','acquisition_failed','persist_failed','skipped'));

create index if not exists qualification_run_leads_stage_idx
  on public.qualification_run_leads (run_id, stage);
