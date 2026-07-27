// How long a soft-deleted campaign (campaigns.deleted_at, see
// app/actions/campaigns.ts deleteCampaign) stays restorable before the
// purge-deleted-campaigns Inngest cron removes it for real.
export const CAMPAIGN_RETENTION_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Days left before permanent purge. Floored at 0 — the cron sweeps anything past it. */
export function daysUntilPurge(deletedAt: string): number {
  const purgeAt = new Date(deletedAt).getTime() + CAMPAIGN_RETENTION_DAYS * MS_PER_DAY;
  return Math.max(0, Math.ceil((purgeAt - Date.now()) / MS_PER_DAY));
}
