import { inngest } from "@/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeCampaignDue } from "@/lib/campaigns/due";
import { assignLeadsToCampaignCore } from "@/lib/campaigns/assign";
import { logCrawl } from "@/lib/pipeline/persist";
import type { CampaignStep, CampaignType } from "@/lib/types";

// Auto-routes leads into the cold/warm follow-up chains
// (docs/instantly-fying-outreachpage/leadpipelinetocampaign.md). Only ever
// considers campaigns with campaign_role <> 'primary' AND status = 'active'
// — every follow-up chain starts life paused (campaigns.status default),
// so this job is a complete no-op until a chain is deliberately activated.
//
// Idempotent by construction, not by a separate "already routed" marker:
// once a lead's campaign_id is updated to point at the target chain, it no
// longer matches either candidate query below on the next tick.
//
// Cold: a lead whose CURRENT (primary) campaign sequence has completed
// (computeCampaignDue returns null) and who has never replied.
// Warm: a lead with at least one positive-sentiment reply and zero
// negative-sentiment replies — routed immediately even if it interrupts an
// in-progress primary/cold sequence (a positive reply always wins), but
// only once (skipped if already on the target warm chain).
export const routeFollowupLeads = inngest.createFunction(
  {
    id: "route-followup-leads",
    name: "Auto-route leads into cold/warm follow-up chains",
    retries: 2,
    concurrency: [{ limit: 1 }], // a single global slot — two overlapping ticks must never double-route the same lead
  },
  { cron: "0 * * * *" }, // hourly — start slow, tighten later once observed working
  async ({ step }) => {
    const admin = createAdminClient();

    const chains = await step.run("load-active-chains", async () => {
      const { data } = await admin
        .from("campaigns")
        .select("id, campaign_type, campaign_role")
        .neq("campaign_role", "primary")
        .eq("status", "active")
        .is("deleted_at", null);
      const byType = new Map<CampaignType, { cold?: string; warm?: string }>();
      for (const c of data ?? []) {
        const entry = byType.get(c.campaign_type as CampaignType) ?? {};
        if (c.campaign_role === "cold_followup") entry.cold = c.id;
        if (c.campaign_role === "warm_followup") entry.warm = c.id;
        byType.set(c.campaign_type as CampaignType, entry);
      }
      return Object.fromEntries(byType) as Record<string, { cold?: string; warm?: string }>;
    });

    if (Object.keys(chains).length === 0) {
      return { skipped: "no_active_followup_chains", coldRouted: 0, warmRouted: 0 };
    }

    // ── Cold candidates ──
    const coldRouted = await step.run("route-cold", async () => {
      const { data: candidateLeads } = await admin
        .from("leads")
        .select("id, lead_type, campaign_id, campaign_variant_id, campaign_step, last_campaign_send_at")
        .not("campaign_id", "is", null)
        .eq("reply_count", 0)
        .in("status", ["qualified", "review"]);
      if (!candidateLeads?.length) return 0;

      const campaignIds = [...new Set(candidateLeads.map((l) => l.campaign_id as string))];
      const { data: campaigns } = await admin
        .from("campaigns")
        .select("id, campaign_role")
        .in("id", campaignIds);
      const primaryCampaignIds = new Set(
        (campaigns ?? []).filter((c) => c.campaign_role === "primary").map((c) => c.id),
      );
      const onPrimary = candidateLeads.filter((l) => primaryCampaignIds.has(l.campaign_id as string));
      if (!onPrimary.length) return 0;

      const variantIds = [...new Set(onPrimary.map((l) => l.campaign_variant_id).filter((v): v is string => !!v))];
      const { data: steps } = variantIds.length
        ? await admin.from("campaign_steps").select("*").in("variant_id", variantIds)
        : { data: [] as CampaignStep[] };
      const stepsByVariant = new Map<string, CampaignStep[]>();
      for (const s of steps ?? []) {
        const arr = stepsByVariant.get(s.variant_id) ?? [];
        arr.push(s);
        stepsByVariant.set(s.variant_id, arr);
      }

      const sequenceComplete = onPrimary.filter((l) => {
        const variantSteps = l.campaign_variant_id ? stepsByVariant.get(l.campaign_variant_id) ?? [] : [];
        return computeCampaignDue(l, variantSteps) === null;
      });
      if (!sequenceComplete.length) return 0;

      const byTargetChain = new Map<string, string[]>();
      for (const l of sequenceComplete) {
        const targetId = chains[l.lead_type as CampaignType]?.cold;
        if (!targetId) continue;
        const arr = byTargetChain.get(targetId) ?? [];
        arr.push(l.id);
        byTargetChain.set(targetId, arr);
      }

      let routed = 0;
      for (const [targetId, leadIds] of byTargetChain) {
        const result = await assignLeadsToCampaignCore(admin, leadIds, targetId);
        routed += result.assigned;
        await logCrawl({
          crawl_job_id: null,
          profile_username: `${leadIds.length} lead(s)`,
          parent_username: null,
          action: "followup_routed_cold",
          depth: 0,
          detail: `-> campaign ${targetId} (assigned=${result.assigned}, skipped=${result.skipped})`,
        });
      }
      return routed;
    });

    // ── Warm candidates ──
    const warmRouted = await step.run("route-warm", async () => {
      const [{ data: positiveRows }, { data: negativeRows }] = await Promise.all([
        admin.from("inbox_messages").select("lead_id").eq("sentiment", "positive"),
        admin.from("inbox_messages").select("lead_id").eq("sentiment", "negative"),
      ]);
      const negativeIds = new Set((negativeRows ?? []).map((r) => r.lead_id));
      const warmCandidateIds = [...new Set((positiveRows ?? []).map((r) => r.lead_id))].filter(
        (id) => !negativeIds.has(id),
      );
      if (!warmCandidateIds.length) return 0;

      const { data: leads } = await admin
        .from("leads")
        .select("id, lead_type, campaign_id")
        .in("id", warmCandidateIds)
        .in("status", ["qualified", "review"]);
      if (!leads?.length) return 0;

      const byTargetChain = new Map<string, string[]>();
      for (const l of leads) {
        const targetId = chains[l.lead_type as CampaignType]?.warm;
        if (!targetId || l.campaign_id === targetId) continue; // no warm chain for this track, or already there
        const arr = byTargetChain.get(targetId) ?? [];
        arr.push(l.id);
        byTargetChain.set(targetId, arr);
      }

      let routed = 0;
      for (const [targetId, leadIds] of byTargetChain) {
        const result = await assignLeadsToCampaignCore(admin, leadIds, targetId);
        routed += result.assigned;
        await logCrawl({
          crawl_job_id: null,
          profile_username: `${leadIds.length} lead(s)`,
          parent_username: null,
          action: "followup_routed_warm",
          depth: 0,
          detail: `-> campaign ${targetId} (assigned=${result.assigned}, skipped=${result.skipped})`,
        });
      }
      return routed;
    });

    return { coldRouted, warmRouted };
  },
);
