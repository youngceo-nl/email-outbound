-- Campaign deletion becomes a soft delete: a deleted campaign is hidden from
-- normal views but kept for 30 days (see lib/campaigns/retention.ts and the
-- purge-deleted-campaigns Inngest cron) so an accidental delete is
-- recoverable. Assigned leads keep their campaign_id/variant/step untouched
-- while soft-deleted, so restoring resumes exactly where it left off.
alter table public.campaigns add column if not exists deleted_at timestamptz;
create index if not exists campaigns_deleted_at_idx on public.campaigns(deleted_at) where deleted_at is not null;
