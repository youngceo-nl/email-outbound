-- Manual review step after AI qualification (docs/KPI/scoring-improvement.md).
-- The AI qualifies a lead; a human then approves or rejects it, and only
-- approved leads enter handover. The reject rate is the KPI we drive down by
-- tuning the AI scorer.
--
-- review_decision is a SEPARATE axis from status on purpose: a lead approved
-- here (review_decision='approved', status='qualified') can later be flipped to
-- status='rejected' by the Clay round-trip without disturbing its review
-- verdict, so the KPI keeps reflecting the human review decision alone.

alter table public.leads
  add column if not exists review_decision text
    check (review_decision in ('approved', 'rejected')),
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null;

-- The review queue: highest-scoring un-reviewed qualified leads first.
create index if not exists leads_review_queue_idx
  on public.leads (overall_score desc nulls last)
  where status = 'qualified' and review_decision is null;

-- KPI window scans: reviewed leads by time.
create index if not exists leads_reviewed_at_idx
  on public.leads (reviewed_at)
  where review_decision is not null;

-- Headline KPI. p_since null = all time. Percentage (rejected/reviewed) is
-- computed by the caller, matching the "return counts, ratio in JS" convention.
create or replace function public.review_stats(p_since timestamptz default null)
returns table (
  approved bigint,
  rejected bigint,
  reviewed bigint
)
language sql
stable
as $$
  select
    count(*) filter (where review_decision = 'approved') as approved,
    count(*) filter (where review_decision = 'rejected') as rejected,
    count(*)                                              as reviewed
  from public.leads
  where review_decision is not null
    and (p_since is null or reviewed_at >= p_since);
$$;

-- Per-day trend so the review page can show the rate moving toward the 5%
-- target as the AI scorer is tuned. Covers the last p_days days of reviews.
create or replace function public.review_stats_by_day(p_days int default 14)
returns table (
  day date,
  approved bigint,
  rejected bigint
)
language sql
stable
as $$
  select
    reviewed_at::date as day,
    count(*) filter (where review_decision = 'approved') as approved,
    count(*) filter (where review_decision = 'rejected') as rejected
  from public.leads
  where review_decision is not null
    and reviewed_at >= (now() - make_interval(days => p_days))
  group by reviewed_at::date
  order by reviewed_at::date;
$$;
