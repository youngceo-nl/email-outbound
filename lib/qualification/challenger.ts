/*
 * Challenger verification.
 *
 * A narrow adversarial second pass over the same evidence, run only where a
 * wrong answer is expensive: proposed auto-approvals, mixed offers, and
 * conflicts. It looks for missed done-for-you evidence, unsupported citations,
 * and unresolved CTA outcomes. It is never asked for a replacement score.
 */

import { snapshotSourceIds } from "@/lib/evidence/collect";
import { CHALLENGER_PROMPT_VERSION } from "@/lib/evidence/versions";
import { buildChallengerUserPrompt, CHALLENGER_SYSTEM_PROMPT } from "./prompt";
import { challengerResultSchema } from "./schemas";
import { parseJsonLoose, type LlmClient } from "./providers";
import type {
  ChallengerResult,
  CommercialExtraction,
  EvidenceSnapshot,
} from "./types";

export type ChallengerDecision = {
  ran: boolean;
  result: ChallengerResult | null;
  agrees: boolean | null;
  disagreements: string[];
  error: string | null;
};

export type ChallengerTrigger =
  | "proposed_auto_approval"
  | "mixed_offers"
  | "conflicting_evidence"
  | "audit_sample"
  | "none";

/*
 * Deliberately does NOT run for reliable universal exclusions or data failures:
 * a second opinion on a profile we could not even load buys nothing, and a
 * reliably excluded agency is not a close call.
 */
export function challengerTrigger(args: {
  proposedAutoApproval: boolean;
  trackMixed: boolean;
  conflicts: number;
  hardExclusion: boolean;
  acquisitionFailed: boolean;
  auditSample?: boolean;
}): ChallengerTrigger {
  if (args.hardExclusion || args.acquisitionFailed) {
    return args.auditSample ? "audit_sample" : "none";
  }
  if (args.proposedAutoApproval) return "proposed_auto_approval";
  if (args.trackMixed) return "mixed_offers";
  if (args.conflicts > 0) return "conflicting_evidence";
  return args.auditSample ? "audit_sample" : "none";
}

export async function runChallenger(opts: {
  snapshot: EvidenceSnapshot;
  extraction: CommercialExtraction;
  llm: LlmClient;
}): Promise<ChallengerDecision> {
  const allowedSources = snapshotSourceIds(opts.snapshot);

  const summary = {
    human_personal_brand: opts.extraction.human_personal_brand.state,
    information_funnel: {
      state: opts.extraction.information_funnel.state,
      label: opts.extraction.information_funnel.label,
      asset_or_offer: opts.extraction.information_funnel.asset_or_offer,
    },
    cta: { state: opts.extraction.cta.state, label: opts.extraction.cta.label },
    transformation: opts.extraction.transformation.state,
    proof: opts.extraction.proof.state,
    authority: opts.extraction.authority.state,
    business_models: opts.extraction.business_models.map((model) => ({
      type: model.type,
      prominence: model.prominence,
    })),
    offers: opts.extraction.offers,
    primary_visitor_outcome: opts.extraction.primary_visitor_outcome,
    primary_cta: opts.extraction.primary_cta,
    ultimate_cta: opts.extraction.ultimate_cta,
    agency_evidence_bundle: opts.extraction.agency_evidence_bundle,
    conflicts: opts.extraction.conflicts,
  };

  let response;
  try {
    response = await opts.llm({
      system: CHALLENGER_SYSTEM_PROMPT,
      user: buildChallengerUserPrompt(opts.snapshot, summary, allowedSources),
      temperature: 0,
      maxTokens: 4000,
    });
  } catch (err) {
    return {
      ran: false,
      result: null,
      agrees: null,
      disagreements: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let parsed;
  try {
    const raw = parseJsonLoose(response.text);
    if (raw && typeof raw === "object") {
      (raw as Record<string, unknown>).challenger_prompt_version = CHALLENGER_PROMPT_VERSION;
    }
    parsed = challengerResultSchema.parse(raw);
  } catch (err) {
    // An unparseable challenger is an unknown, not an endorsement.
    return {
      ran: true,
      result: null,
      agrees: null,
      disagreements: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const result = parsed as ChallengerResult;
  const disagreements = findMaterialDisagreements(opts.extraction, result);

  return {
    ran: true,
    result,
    agrees: disagreements.length === 0,
    disagreements,
    error: null,
  };
}

/*
 * Only material disagreements count. The challenger rating proof `credible`
 * where the extractor said `strong` changes nothing about eligibility; the
 * challenger finding a done-for-you primary model changes everything.
 */
export function findMaterialDisagreements(
  extraction: CommercialExtraction,
  challenger: ChallengerResult,
): string[] {
  const out: string[] = [];

  if (challenger.business_model_conclusion === "agency_service") {
    out.push("challenger concludes the core business is done-for-you service delivery");
  }
  if (challenger.business_model_conclusion === "uncertain") {
    out.push("challenger cannot establish the primary business model");
  }
  if (!challenger.core_gate_passes) {
    out.push("challenger finds the core gate does not pass");
  }
  if (challenger.agency_evidence_bundle.reliability === "reliable") {
    out.push("challenger finds reliable done-for-you agency evidence");
  }

  for (const signal of ["information_funnel", "cta"] as const) {
    const primary = extraction[signal].state;
    const second = challenger.signal_states[signal];
    if (primary === "present" && (second === "absent" || second === "conflicting")) {
      out.push(`challenger reads ${signal} as ${second} where extraction read present`);
    }
  }

  if (
    extraction.primary_visitor_outcome &&
    challenger.visitor_receives.length > 0 &&
    !challenger.visitor_receives.includes(extraction.primary_visitor_outcome)
  ) {
    out.push(
      `challenger visitor outcomes (${challenger.visitor_receives.join(", ")}) exclude the extracted primary outcome ${extraction.primary_visitor_outcome}`,
    );
  }

  if (challenger.acquisition_sufficiency === "insufficient") {
    out.push("challenger finds acquisition insufficient for an automatic decision");
  }

  return out;
}
