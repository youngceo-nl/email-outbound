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

/*
 * Native structured output for the challenger, mirroring challengerResultSchema.
 * Prompt wording alone proved insufficient — the model followed the extraction
 * contract it had been shown. Constraining the shape at generation time removes
 * the ambiguity entirely.
 */
const CITATION = {
  type: "object",
  additionalProperties: false,
  required: ["source_type", "source_id", "url", "field", "phrase"],
  properties: {
    source_type: {
      type: "string",
      enum: [
        "display_name", "bio", "instagram_metadata", "highlight", "link_hub",
        "external_page", "youtube_channel", "youtube_video", "pinned_post", "recent_post",
      ],
    },
    source_id: { type: "string" },
    url: { type: "string" },
    field: { type: "string" },
    phrase: { type: "string" },
  },
} as const;

const SIGNAL_STATE = { type: "string", enum: ["present", "absent", "unknown", "conflicting"] } as const;

export const CHALLENGER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "business_model_conclusion", "primary_cta", "ultimate_cta", "visitor_receives",
    "agency_evidence_bundle", "core_gate_passes", "distinct_information_funnel",
    "cta_chain_resolved", "acquisition_sufficiency", "signal_states", "evidence", "reason",
  ],
  properties: {
    business_model_conclusion: {
      type: "string",
      enum: ["information_personal_brand", "agency_service", "uncertain"],
    },
    primary_cta: { type: "string" },
    ultimate_cta: { type: "string" },
    visitor_receives: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "education", "coaching", "information_product", "community", "live_instruction",
          "membership", "event", "employment_opportunity", "recruiting_service",
          "done_for_you_service", "managed_trading", "signals_service", "affiliate_offer",
          "commerce_product", "software", "entertainment", "unknown",
        ],
      },
    },
    agency_evidence_bundle: {
      type: "object",
      additionalProperties: false,
      required: ["service_delivery", "team_performance", "service_cta", "reliability"],
      properties: {
        service_delivery: { type: "array", items: CITATION },
        team_performance: { type: "array", items: CITATION },
        service_cta: { type: "array", items: CITATION },
        reliability: { type: "string", enum: ["reliable", "incomplete", "absent"] },
      },
    },
    core_gate_passes: { type: "boolean" },
    distinct_information_funnel: { type: "boolean" },
    cta_chain_resolved: { type: "boolean" },
    acquisition_sufficiency: { type: "string", enum: ["sufficient", "partial", "insufficient"] },
    signal_states: {
      type: "object",
      additionalProperties: false,
      required: ["information_funnel", "proof", "authority", "transformation", "cta"],
      properties: {
        information_funnel: SIGNAL_STATE,
        proof: SIGNAL_STATE,
        authority: SIGNAL_STATE,
        transformation: SIGNAL_STATE,
        cta: SIGNAL_STATE,
      },
    },
    evidence: { type: "array", items: CITATION },
    reason: { type: "string" },
  },
} as const;

export type ChallengerDecision = {
  ran: boolean;
  result: ChallengerResult | null;
  agrees: boolean | null;
  disagreements: string[];
  error: string | null;
  /*
   * The challenger runs on a stronger, pricier model than the extractor, so its
   * spend has to be attributable separately. Folding it into one blended token
   * total is what hid the challenger being the majority of a run's cost.
   */
  provider: string | null;
  model: string | null;
  usage: { inputTokens: number; outputTokens: number };
};

const NO_USAGE = { inputTokens: 0, outputTokens: 0 };

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
      // A stronger challenger model reasons at length before answering; 4000 was
      // truncating the verdict mid-JSON and surfacing as a spurious disagreement.
      maxTokens: 8000,
      jsonSchema: CHALLENGER_JSON_SCHEMA as unknown as Record<string, unknown>,
    });
  } catch (err) {
    // The provider threw, so nothing was billed and no model is attributable.
    return {
      ran: false,
      result: null,
      agrees: null,
      disagreements: [],
      error: err instanceof Error ? err.message : String(err),
      provider: null,
      model: null,
      usage: NO_USAGE,
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
    // An unparseable challenger is an unknown, not an endorsement. It still
    // burned tokens, so the usage is reported rather than zeroed.
    return {
      ran: true,
      result: null,
      agrees: null,
      disagreements: [],
      error: err instanceof Error ? err.message : String(err),
      provider: response.provider ?? null,
      model: response.model ?? null,
      usage: response.usage ?? NO_USAGE,
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
    provider: response.provider ?? null,
    model: response.model ?? null,
    usage: response.usage ?? NO_USAGE,
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
