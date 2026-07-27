import { inngest } from "@/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { CAMPAIGN_RETENTION_DAYS } from "@/lib/campaigns/retention";

// Soft-deleted campaigns (app/actions/campaigns.ts deleteCampaign) stay
// restorable for CAMPAIGN_RETENTION_DAYS. Past that window there's nothing
// left to restore, so this sweeps them for real — cascades campaign_variants
// / campaign_steps via FK, and leaves any still-assigned leads' campaign_id
// pointing at nothing (on delete set null), same as an immediate hard delete.
export const purgeDeletedCampaigns = inngest.createFunction(
  { id: "purge-deleted-campaigns", name: "Purge deleted campaigns past retention" },
  { cron: "0 3 * * *" },
  async ({ step }) => {
    const purged = await step.run("purge-expired", async () => {
      const admin = createAdminClient();
      const cutoff = new Date(Date.now() - CAMPAIGN_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { error, count } = await admin
        .from("campaigns")
        .delete({ count: "exact" })
        .not("deleted_at", "is", null)
        .lt("deleted_at", cutoff);
      if (error) throw new Error(error.message);
      return count ?? 0;
    });

    return { purged };
  },
);
