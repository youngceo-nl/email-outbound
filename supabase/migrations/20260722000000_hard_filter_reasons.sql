-- Per-account breakdown of *why* leads were dropped before ever reaching AI
-- scoring — powers the "hard-filtered" stage's hover tooltip on the handover
-- card. Pre-AI rejections only: status='rejected' AND reason_for_score IS NULL
-- (an AI rejection has reason_for_score set and belongs to the AI-scored
-- stage, not here).
--
-- rejection_reason carries a parenthetical suffix, e.g.
-- "followers_below_min (159 < 5000)" (see lib/pipeline/filter.ts), so group on
-- the part before " (" to collapse every threshold variant into one bucket.
create or replace function public.hard_filter_reasons_by_parent()
returns table (
  parent_username text,
  reason          text,
  count           bigint
)
language sql
stable
as $$
  select
    l.parent_username,
    split_part(l.rejection_reason, ' (', 1) as reason,
    count(*) as count
  from public.leads l
  where l.parent_username is not null
    and l.status = 'rejected'
    and l.reason_for_score is null
    and l.rejection_reason is not null
  group by l.parent_username, split_part(l.rejection_reason, ' (', 1);
$$;
