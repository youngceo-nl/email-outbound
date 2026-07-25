-- Parallel qualification track: infopreneurs (sell to) vs partnerships (collab
-- with). Routed by the AI business_model — agency => partnership, everything
-- else => infopreneur (docs/quickfixes/quickfixes02.md follow-up). A partnership
-- lead is judged on audience/niche complementarity, not posting activity, so it
-- must not be rejected by the infopreneur activity filters.
alter table public.leads
  add column if not exists lead_type text not null default 'infopreneur';

-- The review queue filters by track; keep that scan cheap.
create index if not exists leads_review_queue_type_idx
  on public.leads (lead_type, overall_score desc nulls last)
  where status = 'qualified' and review_decision is null;
