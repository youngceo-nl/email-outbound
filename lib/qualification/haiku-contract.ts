/*
 * The Claude Haiku 4.5 evidence-extraction contract.
 *
 * Haiku's entire job is to turn a stored evidence snapshot into cited semantic
 * facts. It never scores, never picks a track, never decides whether the agency
 * exception passes. Those all live in deterministic TypeScript downstream.
 *
 * Two representations live here:
 *   1. EXTRACTION_JSON_SCHEMA — the strict JSON Schema handed to Claude's native
 *      structured-output support, so the shape is constrained at generation time
 *      rather than hoped for in the prompt.
 *   2. haikuExtractionSchema — the Zod schema that re-validates the response
 *      after it arrives. Structured output constrains shape; it cannot enforce
 *      "an affirmative claim must cite evidence", which is the rule that
 *      actually keeps this pipeline honest.
 */

import { z } from "zod";
import {
  evidenceCitationSchema,
  offerTypeSchema,
  customerImplementationRoleSchema,
  proofBeneficiarySchema,
  proofResultTypeSchema,
  visitorOutcomeSchema,
  signalStateSchema,
  signalStrengthSchema,
  prominenceSchema,
  acquisitionSufficiencySchema,
  dataQualitySchema,
} from "./schemas";
import type {
  BusinessModelFact,
  CommercialExtraction,
  EvidenceCitation,
  OfferEvidence,
  OfferProminence,
} from "./types";

// ---------------------------------------------------------------------------
// Enum vocabularies (shared by the JSON Schema and Zod)
// ---------------------------------------------------------------------------

const SIGNAL_STATES = ["present", "absent", "unknown", "conflicting"] as const;
const SIGNAL_STRENGTHS = ["absent", "weak", "credible", "strong"] as const;
const SOURCE_TYPES = [
  "display_name", "bio", "instagram_metadata", "highlight", "link_hub",
  "external_page", "youtube_channel", "youtube_video", "pinned_post", "recent_post",
] as const;
const VISITOR_OUTCOMES = [
  "education", "coaching", "information_product", "community", "live_instruction",
  "membership", "event", "employment_opportunity", "recruiting_service",
  "done_for_you_service", "managed_trading", "signals_service", "affiliate_offer",
  "commerce_product", "software", "entertainment", "unknown",
] as const;
const OFFER_TYPES = [
  "coaching", "information_product", "community", "membership", "event",
  "done_with_you_consulting", "done_for_you_service", "managed_trading",
  "signals_service", "affiliate_offer", "commerce_product", "software",
  "employment", "unknown",
] as const;
const PROMINENCE = ["primary", "secondary", "incidental"] as const;
const IMPLEMENTATION_ROLES = [
  "none", "self_implemented", "implements_with_guidance", "team_implemented", "unknown",
] as const;
const BENEFICIARIES = [
  "self", "student", "coaching_client", "community_member", "agency_client",
  "software_customer", "affiliate", "unknown",
] as const;
const RESULT_TYPES = [
  "revenue", "clients_served", "students_taught", "people_helped", "audience",
  "testimonial", "transformation", "other",
] as const;
const PRIMARY_OFFER_DELIVERY = [
  "information", "done_with_you", "done_for_you_service", "commerce",
  "software", "employment", "none", "unknown",
] as const;

// ---------------------------------------------------------------------------
// JSON Schema for native structured output
// ---------------------------------------------------------------------------

const citationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["source_type", "source_id", "url", "field", "phrase"],
  properties: {
    source_type: { type: "string", enum: SOURCE_TYPES },
    source_id: { type: "string", description: "Must appear in ALLOWED CITATION SOURCES." },
    url: { type: ["string", "null"] },
    field: { type: "string" },
    phrase: { type: "string", description: "Exact or faithfully normalized source text." },
  },
} as const;

const citations = { type: "array", items: citationSchema } as const;

function signalBlock(extra: Record<string, unknown> = {}, extraRequired: string[] = []) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["state", "strength", "evidence", ...extraRequired],
    properties: {
      state: {
        type: "string",
        enum: SIGNAL_STATES,
        description:
          "present = cited evidence supports it. absent = the surface WAS captured and nothing supports it. unknown = the surface was not captured. conflicting = evidence supports incompatible readings.",
      },
      strength: { type: "string", enum: SIGNAL_STRENGTHS },
      evidence: citations,
      ...extra,
    },
  };
}

export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "personal_brand", "audience", "transformation", "information_funnel",
    "conversion_cta", "primary_visitor_outcome", "proof", "authority",
    "named_mechanisms", "offer_inventory", "proof_inventory", "primary_offer",
    "primary_offer_delivery", "done_for_you_service_evidence",
    "independent_information_offer_evidence", "conflicts", "unknowns",
    "acquisition_observations", "citations",
  ],
  properties: {
    personal_brand: signalBlock(),

    audience: {
      type: "object",
      additionalProperties: false,
      required: ["label", "value", "evidence"],
      properties: {
        label: { type: "string", enum: ["none", "broad", "inferred", "specific", "explicit"] },
        value: { type: ["string", "null"], description: "The ideal client in the profile's own words." },
        evidence: citations,
      },
    },

    transformation: signalBlock(
      {
        label: {
          type: "string",
          enum: ["none", "inspirational", "expertise_only", "implied_result", "explicit_result"],
        },
        outcome: { type: ["string", "null"] },
      },
      ["label", "outcome"],
    ),

    information_funnel: signalBlock(
      {
        label: {
          type: "string",
          enum: ["none", "weak_education", "indirect_funnel", "visible_offer", "explicit_offer"],
        },
        visitor_receives: { type: "array", items: { type: "string", enum: VISITOR_OUTCOMES } },
        asset_or_offer: { type: ["string", "null"] },
      },
      ["label", "visitor_receives", "asset_or_offer"],
    ),

    conversion_cta: signalBlock(
      {
        label: {
          type: "string",
          enum: ["none", "audience_only", "information_action", "commercial_action", "direct_sales_action"],
        },
        action: { type: ["string", "null"] },
        token_or_asset: { type: ["string", "null"], description: "The DM/comment keyword or named asset." },
      },
      ["label", "action", "token_or_asset"],
    ),

    primary_visitor_outcome: {
      type: ["string", "null"],
      enum: [...VISITOR_OUTCOMES, null],
      description: "What the visitor ULTIMATELY receives after following the CTA chain to its end.",
    },

    proof: signalBlock(
      { label: { type: "string", enum: ["absent", "weak", "credible", "strong"] } },
      ["label"],
    ),

    authority: signalBlock(
      {
        label: { type: "string", enum: ["absent", "weak", "credible", "strong"] },
        types: { type: "array", items: { type: "string" } },
      },
      ["label", "types"],
    ),

    named_mechanisms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "kind", "evidence"],
        properties: {
          name: { type: "string" },
          kind: {
            type: "string",
            enum: ["method", "framework", "system", "program", "academy", "challenge", "mechanism", "other"],
          },
          evidence: citations,
        },
      },
    },

    offer_inventory: {
      type: "array",
      description: "Every commercially relevant offer, each evaluated independently.",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "offer_id", "name", "type", "prominence", "audience", "delivery",
          "visitor_receives", "customer_implementation_role", "price", "cta", "evidence",
        ],
        properties: {
          offer_id: { type: "string" },
          name: { type: ["string", "null"] },
          type: { type: "string", enum: OFFER_TYPES },
          prominence: { type: "string", enum: PROMINENCE },
          audience: { type: ["string", "null"] },
          delivery: { type: ["string", "null"], description: "How the customer receives it." },
          visitor_receives: { type: "array", items: { type: "string", enum: VISITOR_OUTCOMES } },
          customer_implementation_role: { type: "string", enum: IMPLEMENTATION_ROLES },
          price: { type: ["string", "null"] },
          cta: { type: ["string", "null"] },
          evidence: citations,
        },
      },
    },

    proof_inventory: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "proof_id", "claim", "beneficiary", "result_type", "value", "currency",
          "attributed_offer_id", "producing_model", "self_reported", "evidence",
        ],
        properties: {
          proof_id: { type: "string" },
          claim: { type: "string" },
          beneficiary: {
            type: "string",
            enum: BENEFICIARIES,
            description: "Who got the result. Use unknown rather than guessing.",
          },
          result_type: { type: "string", enum: RESULT_TYPES },
          value: { type: ["number", "null"] },
          currency: { type: ["string", "null"] },
          attributed_offer_id: { type: ["string", "null"] },
          producing_model: { type: ["string", "null"] },
          self_reported: { type: "boolean" },
          evidence: citations,
        },
      },
    },

    primary_offer: {
      type: "object",
      additionalProperties: false,
      required: ["offer_id", "rationale"],
      properties: {
        offer_id: { type: ["string", "null"], description: "An offer_id from offer_inventory, or null." },
        rationale: { type: ["string", "null"] },
      },
    },

    primary_offer_delivery: {
      type: "string",
      enum: PRIMARY_OFFER_DELIVERY,
      description: "How the PRIMARY offer is delivered. done_for_you_service = a team performs the work.",
    },

    done_for_you_service_evidence: {
      type: "object",
      additionalProperties: false,
      required: ["service_delivery", "team_performance", "service_cta", "reliability"],
      properties: {
        service_delivery: citations,
        team_performance: citations,
        service_cta: citations,
        reliability: {
          type: "string",
          enum: ["reliable", "incomplete", "absent"],
          description: "reliable requires corroboration across at least two components, one explicit about done-for-you delivery.",
        },
      },
    },

    independent_information_offer_evidence: {
      type: "object",
      additionalProperties: false,
      required: [
        "own_audience", "own_transformation", "own_cta_path",
        "information_delivery", "sufficient_prominence", "evidence",
      ],
      description:
        "Only meaningful when an agency service is also present. Report each component independently; application code decides whether the exception passes.",
      properties: {
        own_audience: { type: "string", enum: SIGNAL_STATES },
        own_transformation: { type: "string", enum: SIGNAL_STATES },
        own_cta_path: { type: "string", enum: SIGNAL_STATES },
        information_delivery: { type: "string", enum: SIGNAL_STATES },
        sufficient_prominence: { type: "string", enum: SIGNAL_STATES },
        evidence: citations,
      },
    },

    conflicts: { type: "array", items: { type: "string" } },
    unknowns: {
      type: "array",
      items: { type: "string" },
      description: "Surfaces or facts that could not be established. Unknown is never absence.",
    },

    acquisition_observations: {
      type: "object",
      additionalProperties: false,
      required: ["cta_chain_resolved", "acquisition_sufficiency", "data_quality", "unknown_surfaces"],
      properties: {
        cta_chain_resolved: { type: "boolean" },
        acquisition_sufficiency: { type: "string", enum: ["sufficient", "partial", "insufficient"] },
        data_quality: { type: "string", enum: ["complete", "partial", "unreliable"] },
        unknown_surfaces: { type: "array", items: { type: "string" } },
      },
    },

    citations: {
      type: "array",
      description: "Flat index of every citation used above.",
      items: citationSchema,
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Zod re-validation
// ---------------------------------------------------------------------------

function citedBlock<T extends z.ZodRawShape>(name: string, extra: T) {
  return z
    .object({
      state: signalStateSchema,
      strength: signalStrengthSchema,
      evidence: z.array(evidenceCitationSchema).default([]),
      ...extra,
    })
    .strict()
    .superRefine((raw, ctx) => {
      // The generic shape makes Zod's inferred type unresolvable here; the
      // fields being checked are fixed by signalBlockShape regardless of T.
      const block = raw as { state: string; strength: string; evidence?: unknown[] };
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
    });
}

export const haikuExtractionSchema = z
  .object({
    personal_brand: citedBlock("personal_brand", {}),
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
      label: z.enum(["none", "inspirational", "expertise_only", "implied_result", "explicit_result"]),
      outcome: z.string().nullable().default(null),
    }),
    information_funnel: citedBlock("information_funnel", {
      label: z.enum(["none", "weak_education", "indirect_funnel", "visible_offer", "explicit_offer"]),
      visitor_receives: z.array(visitorOutcomeSchema).default([]),
      asset_or_offer: z.string().nullable().default(null),
    }),
    conversion_cta: citedBlock("conversion_cta", {
      label: z.enum(["none", "audience_only", "information_action", "commercial_action", "direct_sales_action"]),
      action: z.string().nullable().default(null),
      token_or_asset: z.string().nullable().default(null),
    }),
    primary_visitor_outcome: visitorOutcomeSchema.nullable().default(null),
    proof: citedBlock("proof", { label: z.enum(["absent", "weak", "credible", "strong"]) }),
    authority: citedBlock("authority", {
      label: z.enum(["absent", "weak", "credible", "strong"]),
      types: z.array(z.string()).default([]),
    }),
    named_mechanisms: z
      .array(
        z
          .object({
            name: z.string(),
            kind: z.enum(["method", "framework", "system", "program", "academy", "challenge", "mechanism", "other"]),
            evidence: z.array(evidenceCitationSchema).default([]),
          })
          .strict(),
      )
      .default([]),
    offer_inventory: z
      .array(
        z
          .object({
            offer_id: z.string().min(1),
            name: z.string().nullable().default(null),
            type: offerTypeSchema,
            prominence: prominenceSchema,
            audience: z.string().nullable().default(null),
            delivery: z.string().nullable().default(null),
            visitor_receives: z.array(visitorOutcomeSchema).default([]),
            customer_implementation_role: customerImplementationRoleSchema,
            price: z.string().nullable().default(null),
            cta: z.string().nullable().default(null),
            evidence: z.array(evidenceCitationSchema).default([]),
          })
          .strict(),
      )
      .default([]),
    proof_inventory: z
      .array(
        z
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
          .strict(),
      )
      .default([]),
    primary_offer: z
      .object({
        offer_id: z.string().nullable().default(null),
        rationale: z.string().nullable().default(null),
      })
      .strict(),
    primary_offer_delivery: z.enum(PRIMARY_OFFER_DELIVERY),
    done_for_you_service_evidence: z
      .object({
        service_delivery: z.array(evidenceCitationSchema).default([]),
        team_performance: z.array(evidenceCitationSchema).default([]),
        service_cta: z.array(evidenceCitationSchema).default([]),
        reliability: z.enum(["reliable", "incomplete", "absent"]),
      })
      .strict()
      .superRefine((bundle, ctx) => {
        if (
          bundle.reliability === "reliable" &&
          bundle.service_delivery.length === 0 &&
          bundle.team_performance.length === 0 &&
          bundle.service_cta.length === 0
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "done_for_you_service_evidence is reliable but no component evidence was cited",
            path: ["reliability"],
          });
        }
      }),
    independent_information_offer_evidence: z
      .object({
        own_audience: signalStateSchema,
        own_transformation: signalStateSchema,
        own_cta_path: signalStateSchema,
        information_delivery: signalStateSchema,
        sufficient_prominence: signalStateSchema,
        evidence: z.array(evidenceCitationSchema).default([]),
      })
      .strict(),
    conflicts: z.array(z.string()).default([]),
    unknowns: z.array(z.string()).default([]),
    acquisition_observations: z
      .object({
        cta_chain_resolved: z.boolean(),
        acquisition_sufficiency: acquisitionSufficiencySchema,
        data_quality: dataQualitySchema,
        unknown_surfaces: z.array(z.string()).default([]),
      })
      .strict(),
    citations: z.array(evidenceCitationSchema).default([]),
  })
  .strict();

export type HaikuExtraction = z.infer<typeof haikuExtractionSchema>;

// ---------------------------------------------------------------------------
// Adapter to the internal contract
// ---------------------------------------------------------------------------

const OFFER_TYPE_TO_MODEL: Record<string, BusinessModelFact["type"]> = {
  coaching: "information_education",
  information_product: "information_education",
  community: "information_education",
  membership: "information_education",
  event: "information_education",
  done_with_you_consulting: "information_education",
  done_for_you_service: "agency_service",
  managed_trading: "agency_service",
  signals_service: "agency_service",
  affiliate_offer: "affiliate",
  commerce_product: "commerce",
  software: "saas",
  employment: "employment",
  unknown: "unknown",
};

const DELIVERY_TO_MODEL: Record<string, BusinessModelFact["type"]> = {
  information: "information_education",
  done_with_you: "information_education",
  done_for_you_service: "agency_service",
  commerce: "commerce",
  software: "saas",
  employment: "employment",
  none: "non_commercial",
  unknown: "unknown",
};

const PROMINENCE_RANK: Record<OfferProminence, number> = {
  primary: 3,
  secondary: 2,
  incidental: 1,
};

/*
 * Business models are DERIVED here rather than asked of the model. Haiku reports
 * offers and how the primary one is delivered; deterministic code turns that into
 * the model/prominence structure the track classifier consumes. Asking Haiku for
 * the business model directly would hand it a classification decision the spec
 * reserves for application code.
 */
export function deriveBusinessModels(extraction: HaikuExtraction): BusinessModelFact[] {
  const byType = new Map<BusinessModelFact["type"], BusinessModelFact>();

  const record = (
    type: BusinessModelFact["type"],
    prominence: OfferProminence,
    evidence: EvidenceCitation[],
  ) => {
    if (type === "unknown") return;
    const existing = byType.get(type);
    if (!existing) {
      byType.set(type, { type, prominence, evidence });
      return;
    }
    if (PROMINENCE_RANK[prominence] > PROMINENCE_RANK[existing.prominence]) {
      existing.prominence = prominence;
    }
    if (existing.evidence.length === 0) existing.evidence = evidence;
  };

  for (const offer of extraction.offer_inventory) {
    const type = OFFER_TYPE_TO_MODEL[offer.type] ?? "unknown";
    record(type, offer.prominence, offer.evidence);
  }

  /*
   * The declared primary delivery is authoritative for which model is primary.
   * Without this, a profile listing one incidental agency offer and one
   * incidental course would produce no primary model at all.
   */
  const primaryType = DELIVERY_TO_MODEL[extraction.primary_offer_delivery];
  if (primaryType && primaryType !== "unknown") {
    const primaryOffer = extraction.offer_inventory.find(
      (offer) => offer.offer_id === extraction.primary_offer.offer_id,
    );
    const evidence =
      primaryOffer?.evidence.length
        ? primaryOffer.evidence
        : extraction.primary_offer_delivery === "done_for_you_service"
          ? extraction.done_for_you_service_evidence.service_delivery
          : extraction.information_funnel.evidence;

    const existing = byType.get(primaryType);
    if (existing) {
      existing.prominence = "primary";
      if (existing.evidence.length === 0) existing.evidence = evidence;
    } else if (evidence.length > 0) {
      byType.set(primaryType, { type: primaryType, prominence: "primary", evidence });
    }
  }

  // A model with no citation cannot be asserted — drop it rather than let an
  // uncited conclusion drive the track.
  return [...byType.values()].filter((model) => model.evidence.length > 0);
}

export function adaptHaikuExtraction(
  extraction: HaikuExtraction,
  snapshotId: string,
  promptVersion: string,
): CommercialExtraction {
  const offers: OfferEvidence[] = extraction.offer_inventory.map((offer) => ({ ...offer }));

  const mechanismTypes = extraction.named_mechanisms.map(
    (mechanism) => `named_${mechanism.kind}:${mechanism.name}`,
  );

  return {
    extraction_prompt_version: promptVersion,
    evidence_snapshot_id: snapshotId,

    human_personal_brand: {
      state: extraction.personal_brand.state,
      strength: extraction.personal_brand.strength,
      evidence: extraction.personal_brand.evidence,
    },
    audience: extraction.audience,
    transformation: extraction.transformation,
    information_funnel: extraction.information_funnel,
    cta: extraction.conversion_cta,
    proof: {
      state: extraction.proof.state,
      strength: extraction.proof.strength,
      label: extraction.proof.label,
      claims: extraction.proof_inventory,
      evidence: extraction.proof.evidence,
    },
    authority: {
      ...extraction.authority,
      // Named mechanisms are authority evidence: they show why this person can
      // teach the subject. They are not a separate scoring dimension.
      types: [...extraction.authority.types, ...mechanismTypes],
    },

    business_models: deriveBusinessModels(extraction),
    offers,
    proof_attribution: extraction.proof_inventory,

    primary_visitor_outcome: extraction.primary_visitor_outcome,
    primary_cta: extraction.conversion_cta.action,
    ultimate_cta: extraction.primary_offer.offer_id
      ? (offers.find((offer) => offer.offer_id === extraction.primary_offer.offer_id)?.cta ?? null)
      : null,
    cta_chain_resolved: extraction.acquisition_observations.cta_chain_resolved,
    acquisition_sufficiency: extraction.acquisition_observations.acquisition_sufficiency,

    agency_evidence_bundle: extraction.done_for_you_service_evidence,
    agency_service_evidence: extraction.done_for_you_service_evidence.service_delivery,
    exclusion_evidence: [],
    conflicts: extraction.conflicts,
    data_quality: extraction.acquisition_observations.data_quality,
    unknown_surfaces: [
      ...extraction.acquisition_observations.unknown_surfaces,
      ...extraction.unknowns,
    ],

    independent_information_offer: extraction.independent_information_offer_evidence,
    named_mechanisms: extraction.named_mechanisms,
  };
}
