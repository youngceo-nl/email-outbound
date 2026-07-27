"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveAssumptions } from "@/lib/report/assumptions/resolve";
import { ASSUMPTION_LABEL, type AssumptionKey, type ReportOverrides } from "@/lib/report/assumptions/defaults";
import { getLeadForReport, createReport, listReportsForLead } from "@/lib/report/service";

/*
 * Server actions behind the Generate Report button.
 *
 * This only creates the row. The actual run happens in
 * /api/reports/<id>/generate, driven by the client — see runReport for why it is
 * not an Inngest job.
 */

export type GenerateResult = { ok: true; reportId: string } | { ok: false; error: string };

/** Only these are user-settable; anything else is resolved by the cascade. */
const EDITABLE: AssumptionKey[] = [
  "front_end_price",
  "backend_offer_price",
  "ad_spend",
  "paid_cost_per_registration",
  "worst_case_cpl",
  "organic_visitors",
  "organic_optin_rate",
  "show_up_rate",
  "front_end_purchase_rate",
  "backend_ascension_rate",
];

/** Rates are entered as percentages in the form and held as fractions internally. */
const RATE_KEYS = new Set<AssumptionKey>([
  "organic_optin_rate",
  "show_up_rate",
  "front_end_purchase_rate",
  "backend_ascension_rate",
]);

export async function generateReportForLead(leadId: string, formData: FormData): Promise<GenerateResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const lead = await getLeadForReport(leadId);
  if (!lead) return { ok: false, error: "Lead not found." };

  const overrides: ReportOverrides = {};
  for (const key of EDITABLE) {
    const raw = formData.get(key);
    if (typeof raw !== "string" || raw.trim() === "") continue;

    // Tolerant of "$2,000" and "25%" — a strategist typing into a form should not
    // have to strip formatting for the value to register.
    const cleaned = raw.replace(/[$,%\s]/g, "");
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed) || parsed < 0) continue;

    overrides[key] = RATE_KEYS.has(key) ? parsed / 100 : parsed;
  }

  // The low ticket is not a scenario input — it exists for the offer ladder,
  // where an entry product that exists is evidence and changes the routing.
  const lowRaw = formData.get("ladder_low_price");
  if (typeof lowRaw === "string" && lowRaw.trim() !== "") {
    const low = Number(lowRaw.replace(/[$,%\s]/g, ""));
    if (Number.isFinite(low) && low > 0) overrides.ladder_low_price = low;
  }

  try {
    const report = await createReport({
      leadId,
      overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
      confirmedBy: user.email ?? null,
      createdBy: user.email ?? null,
    });

    revalidatePath(`/leads/${lead.username}`);
    // The caller now POSTs to /api/reports/<id>/generate. Deliberately not
    // triggered here: work started inside a server action can be killed the
    // instant the action returns, whereas a client-held fetch keeps the function
    // alive until generation answers.
    return { ok: true, reportId: report.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not queue the report." };
  }
}

export type PanelInput = {
  key: AssumptionKey;
  label: string;
  /** Pre-filled value in the form's own units — percent for rates. */
  value: string;
  tier: string;
  source: string;
  needsConfirmation: boolean;
  isRate: boolean;
};

/**
 * What the assumptions panel shows before generating: every input pre-resolved
 * through the cascade, with the basis it resolved at.
 *
 * Pre-filling from the cascade rather than showing an empty form is the point —
 * the common case is confirming a scraped price and clicking through, not typing
 * ten numbers.
 */
export async function getAssumptionPanel(
  leadId: string,
): Promise<{ inputs: PanelInput[]; warnings: string[]; reportCount: number } | null> {
  const lead = await getLeadForReport(leadId);
  if (!lead) return null;

  const resolved = resolveAssumptions({
    followers: lead.followers,
    niche: lead.niche,
    businessModel: lead.business_model,
    funnelPrice: lead.funnel_price,
    funnelPriceObservedAt: lead.funnel_extracted_at,
    funnelPlatform: lead.funnel_platform,
  });

  const reports = await listReportsForLead(leadId);

  return {
    inputs: resolved.resolved
      .filter((input) => EDITABLE.includes(input.key))
      .map<PanelInput>((input) => {
        const isRate = RATE_KEYS.has(input.key);
        return {
          key: input.key,
          label: ASSUMPTION_LABEL[input.key],
          value: isRate ? String(Math.round(input.value * 1000) / 10) : String(Math.round(input.value * 100) / 100),
          tier: input.tier,
          source: input.source,
          needsConfirmation: input.needsConfirmation,
          isRate,
        };
      }),
    warnings: resolved.warnings,
    reportCount: reports.length,
  };
}
