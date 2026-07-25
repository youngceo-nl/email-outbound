-- "Unsure" on the Review page: defer a lead to the end of the queue without
-- deciding it. review_deferred_at is separate from review_decision on purpose —
-- a deferral is not an approve/reject, so it stays out of the bad-lead KPI
-- (review_stats) and the lead remains pending. The queue sorts undeferred leads
-- (null) first by score, deferred ones last (docs/KPI/scoring-improvement.md).
alter table public.leads add column if not exists review_deferred_at timestamptz;

-- Matches the queue's sort: deferred-last, then score, over pending leads only.
create index if not exists leads_review_queue_deferred_idx
  on public.leads (review_deferred_at, overall_score desc)
  where status = 'qualified' and review_decision is null;
