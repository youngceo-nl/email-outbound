-- =============================================================================
-- 20260613100000_metrics.sql — daily activity metrics for the dashboard
-- =============================================================================
-- Returns one row per day for the last `days_back` days (gaps filled with zero)
-- with the headline counters the dashboard graphs over time:
--   scraped    — profiles actually loaded/scraped that day (crawl_logs)
--   discovered — new lead rows created that day
--   qualified  — leads created that day that ended up qualified
--   emails     — emails found that day
--   offers     — bio-link offers found that day
--   outreach   — outreach emails sent that day
--
-- Aggregation happens in Postgres (indexed range scans) so the client never has
-- to pull thousands of rows just to bucket them.

create or replace function public.metrics_daily(days_back int default 30)
returns table (
  day        date,
  scraped    bigint,
  discovered bigint,
  qualified  bigint,
  emails     bigint,
  offers     bigint,
  outreach   bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with span as (
    select generate_series(
      (current_date - (greatest(days_back, 1) - 1))::date,
      current_date,
      interval '1 day'
    )::date as day
  )
  select
    s.day,
    (select count(*) from crawl_logs cl
       where cl.action = 'scraped'
         and cl.created_at >= s.day::timestamptz
         and cl.created_at <  (s.day + 1)::timestamptz)                       as scraped,
    (select count(*) from leads l
       where l.created_at >= s.day::timestamptz
         and l.created_at <  (s.day + 1)::timestamptz)                        as discovered,
    (select count(*) from leads l
       where l.status = 'qualified'
         and l.created_at >= s.day::timestamptz
         and l.created_at <  (s.day + 1)::timestamptz)                        as qualified,
    (select count(*) from leads l
       where l.email is not null
         and l.enriched_at >= s.day::timestamptz
         and l.enriched_at <  (s.day + 1)::timestamptz)                       as emails,
    (select count(*) from leads l
       where l.funnel_program_name is not null
         and l.funnel_extracted_at >= s.day::timestamptz
         and l.funnel_extracted_at <  (s.day + 1)::timestamptz)              as offers,
    (select count(*) from outreach_messages o
       where o.status = 'sent'
         and o.sent_at >= s.day::timestamptz
         and o.sent_at <  (s.day + 1)::timestamptz)                          as outreach
  from span s
  order by s.day;
$$;

grant execute on function public.metrics_daily(int) to authenticated, anon, service_role;
