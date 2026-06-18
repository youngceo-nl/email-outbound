-- Track why a lead's metadata couldn't be backfilled (e.g. blocked, private, not_found).
-- NULL means no error / not yet attempted. Non-null means permanently skipped.
alter table public.leads
  add column if not exists backfill_error text default null;

comment on column public.leads.backfill_error is
  'Reason metadata backfill failed (blocked, private, not_found). NULL = not failed.';
