/*
 * Strict runtime validation for the qualification contracts.
 *
 * Two rules carry most of the weight:
 *   1. An affirmative claim without a citation is invalid. The model is not
 *      allowed to assert a signal it cannot point at.
 *   2. Unknown capture states may never be dressed up as captured absence.
 */

import { z } from "zod";
import type { CommercialExtraction } from "./types";

export const captureStatusSchema = z.enum([
  "captured",
  "unavailable",
  "failed",
  "not_attempted",
]);

export const evidenceSourceTypeSchema = z.enum([
  "display_name",
  "bio",
  "instagram_metadata",
  "highlight",
  "link_hub",
  "external_page",
  "youtube_channel",
  "youtube_video",
  "pinned_post",
  "recent_post",
]);

export const evidenceCitationSchema = z
  .object({
    source_type: evidenceSourceTypeSchema,
    source_id: z.string().min(1),
    // Structured output sends "" instead of null for absent URLs.
    url: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? null : value),
      z.string().nullable().default(null),
    ),
    field: z.string().min(1),
    phrase: z.string().min(1).max(600),
  })
  .strict();

export const visitorOutcomeSchema = z.enum([
  "education",
  "coaching",
  "information_product",
  "community",
  "live_instruction",
  "membership",
  "event",
  "employment_opportunity",
  "recruiting_service",
  "done_for_you_service",
  "managed_trading",
  "signals_service",
  "affiliate_offer",
  "commerce_product",
  "software",
  "entertainment",
  "unknown",
]);

export const destinationTypeSchema = z.enum([
  "application",
  "booking",
  "lead_magnet",
  "education",
  "youtube",
  "link_hub",
  "agency_service",
  "community",
  "store",
  "unknown",
  "none",
]);

export const signalStateSchema = z.enum(["present", "absent", "unknown", "conflicting"]);
export const signalStrengthSchema = z.enum(["absent", "weak", "credible", "strong"]);
export const prominenceSchema = z.enum(["primary", "secondary", "incidental"]);
export const acquisitionSufficiencySchema = z.enum(["sufficient", "partial", "insufficient"]);
export const dataQualitySchema = z.enum(["complete", "partial", "unreliable"]);
export const certaintySchema = z.enum(["high", "medium", "low"]);

export const offerTypeSchema = z.enum([
  "coaching",
  "information_product",
  "community",
  "membership",
  "event",
  "done_with_you_consulting",
  "done_for_you_service",
  "managed_trading",
  "signals_service",
  "affiliate_offer",
  "commerce_product",
  "software",
  "employment",
  "unknown",
]);

export const customerImplementationRoleSchema = z.enum([
  "none",
  "self_implemented",
  "implements_with_guidance",
  "team_implemented",
  "unknown",
]);

export const proofBeneficiarySchema = z.enum([
  "self",
  "student",
  "coaching_client",
  "community_member",
  "agency_client",
  "software_customer",
  "affiliate",
  "unknown",
]);

export const proofResultTypeSchema = z.enum([
  "revenue",
  "clients_served",
  "students_taught",
  "people_helped",
  "audience",
  "testimonial",
  "transformation",
  "other",
]);

export const paidStatusSchema = z.enum(["paid", "free", "unknown"]);
export const offerActiveStatusSchema = z.enum(["active", "inactive", "unknown"]);

export const offerEvidenceSchema = z
  .object({
    offer_id: z.string().min(1),
    name: z.string().nullable().default(null),
    type: offerTypeSchema,
    prominence: prominenceSchema,
    audience: z.string().nullable().default(null),
    delivery: z.string().nullable().default(null),
    visitor_receives: z.array(visitorOutcomeSchema).default([]),
    customer_implementation_role: customerImplementationRoleSchema.default("unknown"),
    price: z.string().nullable().default(null),
    cta: z.string().nullable().default(null),
    evidence: z.array(evidenceCitationSchema).default([]),
    is_paid: paidStatusSchema.default("unknown"),
    active_status: offerActiveStatusSchema.default("unknown"),
  })
  .strict();

/*
 * `beneficiary` has no default on purpose. The spec requires every proof claim
 * to be attributed to what produced it or explicitly marked `unknown` — an
 * omitted field would silently become an unattributed claim propping up a
 * qualification it never earned.
 */
export const proofEvidenceSchema = z
  .object({
    proof_id: z.string().min(1),
    claim: z.string().min(1),
    beneficiary: proofBeneficiarySchema,
    result_type: proofResultTypeSchema,
    value: z.number().nullable().default(null),
    currency: z.string().nullable().default(null),
    attributed_offer_id: z.string().nullable().default(null),
    producing_model: z.string().nullable().default(null),
    self_reported: z.boolean().default(true),
    evidence: z.array(evidenceCitationSchema).default([]),
  })
  .strict();

export const ctaHopSchema = z
  .object({
    hop: z.number().int().min(0),
    source_type: z.enum([
      "instagram_profile",
      "link_hub",
      "external_page",
      "youtube_channel",
      "youtube_video",
    ]),
    source_id: z.string().min(1),
    action: z.string().min(1),
    destination_url: z.string().nullable().default(null),
    visitor_receives: visitorOutcomeSchema.nullable().default(null),
    evidence: z.string().default(""),
  })
  .strict();

/*
 * Hops describe an ordered visitor journey. Out-of-order or duplicated hop
 * numbers make the chain unreplayable, so they are a validation error rather
 * than something to silently sort.
 */
export const ctaChainSchema = z.array(ctaHopSchema).superRefine((hops, ctx) => {
  for (let i = 0; i < hops.length; i++) {
    if (hops[i].hop !== i) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `cta_chain hop numbers must be sequential from 0; index ${i} has hop ${hops[i].hop}`,
        path: [i, "hop"],
      });
    }
  }
});

const agencyEvidenceBundleSchema = z
  .object({
    service_delivery: z.array(evidenceCitationSchema).default([]),
    team_performance: z.array(evidenceCitationSchema).default([]),
    service_cta: z.array(evidenceCitationSchema).default([]),
    reliability: z.enum(["reliable", "incomplete", "absent"]),
  })
  .strict();

const signalBlockShape = {
  state: signalStateSchema,
  strength: signalStrengthSchema,
  evidence: z.array(evidenceCitationSchema).default([]),
};

/*
 * The core anti-hallucination rule. `present` and `conflicting` are affirmative
 * readings of the evidence, so they must point at something. `absent` and
 * `unknown` need no citation — there is nothing to cite.
 */
function requireCitationsWhenAffirmative(
  block: { state?: string; strength?: string; evidence?: unknown[] },
  ctx: z.RefinementCtx,
  name: string,
): void {
  const evidence = block.evidence ?? [];
  const affirmative = block.state === "present" || block.state === "conflicting";
  if (affirmative && evidence.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${name}.state is "${block.state}" but no evidence was cited`,
      path: ["evidence"],
    });
  }
  if (block.strength !== "absent" && evidence.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${name}.strength is "${block.strength}" but no evidence was cited`,
      path: ["evidence"],
    });
  }
  if (block.state === "absent" && block.strength !== "absent") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${name} cannot be absent with strength "${block.strength}"`,
      path: ["strength"],
    });
  }
}

function citedBlock<T extends z.ZodRawShape>(name: string, extra: T) {
  return z
    .object({ ...signalBlockShape, ...extra })
    .strict()
    .superRefine((block, ctx) => requireCitationsWhenAffirmative(block, ctx, name));
}

export const commercialExtractionSchema = z
  .object({
    extraction_prompt_version: z.string().min(1),
    evidence_snapshot_id: z.string().min(1),

    human_personal_brand: citedBlock("human_personal_brand", {}),

    audience: z
      .object({
        label: z.enum(["none", "broad", "inferred", "specific", "explicit"]),
        value: z.string().nullable().default(null),
        evidence: z.array(evidenceCitationSchema).default([]),
      })
      .strict()
      .superRefine((audience, ctx) => {
        if (audience.label !== "none" && audience.evidence.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `audience.label is "${audience.label}" but no evidence was cited`,
            path: ["evidence"],
          });
        }
      }),

    transformation: citedBlock("transformation", {
      label: z.enum([
        "none",
        "inspirational",
        "expertise_only",
        "implied_result",
        "explicit_result",
      ]),
      outcome: z.string().nullable().default(null),
    }),

    information_funnel: citedBlock("information_funnel", {
      label: z.enum([
        "none",
        "weak_education",
        "indirect_funnel",
        "visible_offer",
        "explicit_offer",
      ]),
      visitor_receives: z.array(visitorOutcomeSchema).default([]),
      asset_or_offer: z.string().nullable().default(null),
    }),

    cta: citedBlock("cta", {
      label: z.enum([
        "none",
        "audience_only",
        "information_action",
        "commercial_action",
        "direct_sales_action",
      ]),
      action: z.string().nullable().default(null),
      token_or_asset: z.string().nullable().default(null),
    }),

    proof: citedBlock("proof", {
      label: z.enum(["absent", "weak", "credible", "strong"]),
      claims: z.array(proofEvidenceSchema).default([]),
    }),

    authority: citedBlock("authority", {
      label: z.enum(["absent", "weak", "credible", "strong"]),
      types: z.array(z.string()).default([]),
    }),

    business_models: z
      .array(
        z
          .object({
            type: z.enum([
              "information_education",
              "agency_service",
              "commerce",
              "saas",
              "affiliate",
              "employment",
              "non_commercial",
              "unknown",
            ]),
            prominence: prominenceSchema,
            evidence: z.array(evidenceCitationSchema).default([]),
          })
          .strict()
          .superRefine((model, ctx) => {
            if (model.type !== "unknown" && model.evidence.length === 0) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `business_models entry "${model.type}" has no cited evidence`,
                path: ["evidence"],
              });
            }
          }),
      )
      .default([]),

    offers: z.array(offerEvidenceSchema).default([]),
    proof_attribution: z.array(proofEvidenceSchema).default([]),

    primary_visitor_outcome: visitorOutcomeSchema.nullable().default(null),
    primary_cta: z.string().nullable().default(null),
    ultimate_cta: z.string().nullable().default(null),
    cta_chain_resolved: z.boolean().default(false),
    acquisition_sufficiency: acquisitionSufficiencySchema,

    agency_evidence_bundle: agencyEvidenceBundleSchema,
    agency_service_evidence: z.array(evidenceCitationSchema).default([]),
    exclusion_evidence: z.array(evidenceCitationSchema).default([]),
    conflicts: z.array(z.string()).default([]),
    data_quality: dataQualitySchema,
    unknown_surfaces: z.array(z.string()).default([]),
  })
  .strict()
  .superRefine((extraction, ctx) => {
    // A "reliable" agency bundle drives a hard rejection. It must be evidenced.
    if (
      extraction.agency_evidence_bundle.reliability === "reliable" &&
      extraction.agency_evidence_bundle.service_delivery.length === 0 &&
      extraction.agency_evidence_bundle.team_performance.length === 0 &&
      extraction.agency_evidence_bundle.service_cta.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "agency_evidence_bundle.reliability is reliable but no component evidence was cited",
        path: ["agency_evidence_bundle"],
      });
    }
  });

export const challengerResultSchema = z
  .object({
    challenger_prompt_version: z.string().min(1).default("challenger-v1"),
    business_model_conclusion: z.enum([
      "information_personal_brand",
      "agency_service",
      "uncertain",
    ]),
    primary_cta: z.string().nullable().default(null),
    ultimate_cta: z.string().nullable().default(null),
    visitor_receives: z.array(visitorOutcomeSchema).default([]),
    agency_evidence_bundle: agencyEvidenceBundleSchema,
    core_gate_passes: z.boolean(),
    distinct_information_funnel: z.boolean().default(false),
    cta_chain_resolved: z.boolean().default(false),
    acquisition_sufficiency: acquisitionSufficiencySchema,
    signal_states: z
      .object({
        information_funnel: signalStateSchema,
        proof: signalStateSchema,
        authority: signalStateSchema,
        transformation: signalStateSchema,
        cta: signalStateSchema,
      })
      .strict(),
    evidence: z.array(evidenceCitationSchema).default([]),
    reason: z.string().default(""),
  })
  .strict();

export const qualificationVersionsSchema = z
  .object({
    acquisition_version: z.string().min(1),
    extraction_prompt_version: z.string().min(1),
    challenger_prompt_version: z.string().min(1),
    scorecard_version: z.string().min(1),
    config_version: z.string().min(1),
    pipeline_version: z.string().min(1),
  })
  .strict();

export type ParsedCommercialExtraction = z.infer<typeof commercialExtractionSchema>;

/*
 * Citations must resolve against the snapshot that was actually inspected.
 * A model that cites `external_page:destination_7` when only three destinations
 * were captured has invented its evidence, and the extraction is rejected.
 */
export function validateCitationsResolve(
  extraction: CommercialExtraction,
  knownSourceIds: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const citation of collectCitations(extraction)) {
    const key = `${citation.source_type}:${citation.source_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!knownSourceIds.has(key)) {
      problems.push(`citation ${key} does not exist in the evidence snapshot`);
    }
  }
  return problems;
}

export function collectCitations(
  extraction: CommercialExtraction,
): Array<{ source_type: string; source_id: string; phrase: string; field: string }> {
  const out: Array<{ source_type: string; source_id: string; phrase: string; field: string }> = [];
  const push = (list: readonly { source_type: string; source_id: string; phrase: string; field: string }[] | undefined) => {
    if (list) out.push(...list);
  };

  push(extraction.human_personal_brand.evidence);
  push(extraction.audience.evidence);
  push(extraction.transformation.evidence);
  push(extraction.information_funnel.evidence);
  push(extraction.cta.evidence);
  push(extraction.proof.evidence);
  push(extraction.authority.evidence);
  push(extraction.agency_service_evidence);
  push(extraction.exclusion_evidence);
  push(extraction.agency_evidence_bundle.service_delivery);
  push(extraction.agency_evidence_bundle.team_performance);
  push(extraction.agency_evidence_bundle.service_cta);
  for (const model of extraction.business_models) push(model.evidence);
  for (const offer of extraction.offers) push(offer.evidence);
  for (const proof of extraction.proof_attribution) push(proof.evidence);
  for (const claim of extraction.proof.claims) push(claim.evidence);

  return out;
}
