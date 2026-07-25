-- Add last_inflight_activity so the handover blocks can tell "actively
-- processing" from "stalled". stillProcessing was derived purely from lead
-- state (pending_backfill/needs_filter/needs_verify > 0), so leads that were
-- discovered but never backfilled — followers null, no error, untouched for
-- weeks — showed a spinning "processing" badge forever even though no job was
-- touching them. The touch_leads trigger bumps updated_at on every write, so
-- the max updated_at across an account's in-flight leads is a truthful "is a
-- process actually running" signal: recent = processing, stale = stalled.
drop function if exists public.lead_counts_by_parent();

create function public.lead_counts_by_parent()
returns table (
  parent_username        text,
  total                  bigint,
  pending_backfill       bigint,
  backfilled             bigint,
  filtered               bigint,
  verified               bigint,
  needs_filter           bigint,
  needs_verify           bigint,
  rejected               bigint,
  last_inflight_activity timestamptz
)
language sql
stable
as $$
  select
    l.parent_username,
    count(*) as total,
    count(*) filter (
      where l.followers is null
        and (l.backfill_error is null or l.backfill_error = 'apify_exhausted')
        and l.status <> 'rejected'
    ) as pending_backfill,
    count(*) filter (where l.followers is not null) as backfilled,
    count(*) filter (
      where l.followers is not null
        and (l.reason_for_score is not null or l.hard_filter_passed_at is not null)
    ) as filtered,
    count(*) filter (where l.reason_for_score is not null) as verified,
    count(*) filter (
      where l.followers is not null
        and l.status = 'pending'
        and l.hard_filter_passed_at is null
    ) as needs_filter,
    count(*) filter (
      where l.status = 'pending'
        and l.hard_filter_passed_at is not null
    ) as needs_verify,
    count(*) filter (
      where l.followers is not null
        and l.status = 'rejected'
    ) as rejected,
    -- Newest touch across the three in-flight buckets (pending_backfill,
    -- needs_filter, needs_verify). Null when nothing is in flight.
    max(l.updated_at) filter (
      where (
        l.followers is null
        and (l.backfill_error is null or l.backfill_error = 'apify_exhausted')
        and l.status <> 'rejected'
      )
      or (
        l.followers is not null
        and l.status = 'pending'
        and l.hard_filter_passed_at is null
      )
      or (
        l.status = 'pending'
        and l.hard_filter_passed_at is not null
      )
    ) as last_inflight_activity
  from public.leads l
  where l.parent_username is not null
  group by l.parent_username;
$$;
