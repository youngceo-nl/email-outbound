-- "Revised Instagram ICP Qualification Logic": the four hard gates and the
-- 12-point six-dimension scorer replace the old 10-point commercial_fit
-- system (lib/qualification/decide.ts, icp-gates.ts, icp-score.ts).
--
-- The full gate/score breakdown already lands in
-- lead_qualification_decisions.payload (jsonb, CommercialDecision) with no
-- migration needed — that has been the storage pattern for every rich field
-- this pipeline has added. These two columns are added because they are
-- what "queryable without unpacking jsonb" actually requires: the PDF's own
-- four-value tier, and the 0-12 headline number analysts will sort/filter on
-- directly, same denormalized-for-filtering role `commercial_fit` already
-- plays.
--
-- `commercial_fit` and the old `decision`/`mode` CHECK constraints are left
-- exactly as they are — decision/mode keep being populated (see
-- lib/qualification/repository.ts), just now derived from the new gates and
-- score instead of the old one. See docs/... PDF plan for why `leads.status`
-- (a native Postgres enum) was deliberately NOT altered here.

alter table public.lead_qualification_decisions
  add column if not exists qualification text
    check (qualification in ('QUALIFIED_HIGH_PRIORITY', 'QUALIFIED', 'MANUAL_REVIEW', 'REJECTED')),
  add column if not exists total_icp_score numeric(4,2);

create index if not exists lead_qualification_decisions_qualification_idx
  on public.lead_qualification_decisions (qualification, created_at desc);
