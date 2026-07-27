// Pure due-step computation for a campaign-assigned lead — shared by
// getCampaignSendQueue (app/actions/campaigns.ts) so the arithmetic lives in
// exactly one place. A lead's variant is fixed at assignment time
// (leads.campaign_variant_id), so this only ever needs that variant's own
// step list, never the whole campaign's.
import type { CampaignStep } from "@/lib/types";

export type CampaignDueInfo = {
  stepNumber: number;
  totalSteps: number;
  isDue: boolean;
  dueAt: string | null;
  subjectTemplate: string;
  bodyTemplate: string;
};

/** Null means the sequence is complete (or the variant has no steps at all). */
export function computeCampaignDue(
  lead: { campaign_step: number | null; last_campaign_send_at: string | null },
  variantSteps: CampaignStep[],
): CampaignDueInfo | null {
  const totalSteps = variantSteps.length;
  const nextStepNumber = (lead.campaign_step ?? 0) + 1;
  if (nextStepNumber > totalSteps) return null;
  const step = variantSteps.find((s) => s.step_number === nextStepNumber);
  if (!step) return null;

  let isDue = true;
  let dueAt: string | null = null;
  if ((lead.campaign_step ?? 0) > 0 && lead.last_campaign_send_at) {
    const due = new Date(lead.last_campaign_send_at);
    due.setDate(due.getDate() + step.delay_days);
    dueAt = due.toISOString();
    isDue = Date.now() >= due.getTime();
  }

  return {
    stepNumber: nextStepNumber,
    totalSteps,
    isDue,
    dueAt,
    subjectTemplate: step.subject_template,
    bodyTemplate: step.body_template,
  };
}

/** Weighted-random pick — used once per lead at assignment time. */
export function rollVariant<T extends { id: string; weight_pct: number }>(variants: T[]): T {
  const total = variants.reduce((sum, v) => sum + v.weight_pct, 0);
  let roll = Math.random() * total;
  for (const v of variants) {
    roll -= v.weight_pct;
    if (roll <= 0) return v;
  }
  return variants[variants.length - 1];
}
