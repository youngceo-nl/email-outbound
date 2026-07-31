/*
 * The Claude Haiku 4.5 evidence-extraction contract.
 *
 * Haiku's entire job is to turn a stored evidence snapshot into cited semantic
 * facts. It never scores, never picks a track, never decides whether the agency
 * exception passes. Those all live in deterministic TypeScript downstream.
 *
 * Citations are modelled as ONE top-level table plus integer references from each
 * signal. Inlining a full citation object under every signal made the compiled
 * grammar for structured output blow past its size limit — the citation shape
 * alone repeated about twenty times. The reference table says the same thing far
 * more cheaply, and it removes duplicate citations for free.
 *
 * Two representations live here:
 *   1. EXTRACTION_JSON_SCHEMA — the strict JSON Schema handed to Claude's native
 *      structured-output support, so the shape is constrained at generation time
 *      rather than hoped for in the prompt.
 *   2. haikuExtractionSchema — the Zod schema that re-validates the response.
 *      Structured output constrains SHAPE; it cannot enforce "an affirmative
 *      claim must cite evidence", which is the rule that keeps this honest. That
 *      check runs in validateAffirmativeCitations, after references resolve.
 */

import { z } from "zod";
import {
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
  evidenceSourceTypeSchema,
} from "./schemas";
import type {
  BusinessModelFact,
  CommercialExtraction,
  EvidenceCitation,
  OfferEvidence,
  OfferProminence,
  VisitorOutcome,
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

/** Integer indexes into the top-level `citations` table. */
const ids = {
  type: "array",
  items: { type: "integer" },
  description: "Indexes into the top-level citations array.",
} as const;

const str = { type: "string" } as const;

function signalBlock(extra: Record<string, unknown> = {}, extraRequired: string[] = []) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["state", "strength", "evidence_ids", ...extraRequired],
    properties: {
      state: {
        type: "string",
        enum: SIGNAL_STATES,
        description:
          "present = cited evidence supports it. absent = the surface WAS captured and nothing supports it. unknown = the surface was not captured. conflicting = evidence supports incompatible readings.",
      },
      strength: { type: "string", enum: SIGNAL_STRENGTHS },
      evidence_ids: ids,
      ...extra,
    },
  };
}

const FIELD_CATALOGUE = {
  type: "object",
  additionalProperties: false,
  required: [
    "citations", "personal_brand", "audience", "transformation", "information_funnel",
    "conversion_cta", "primary_visitor_outcome", "proof", "authority",
    "named_mechanisms", "offer_inventory", "proof_inventory", "primary_offer",
    "primary_offer_delivery", "done_for_you_service_evidence",
    "independent_information_offer_evidence", "conflicts", "unknowns",
    "acquisition_observations",
  ],
  properties: {
    citations: {
      type: "array",
      description:
        "Every citation you use, listed once. Other fields reference these by array index.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source_type", "source_id", "url", "field", "phrase"],
        properties: {
          source_type: { type: "string", enum: SOURCE_TYPES },
          source_id: { type: "string", description: "Must appear in ALLOWED CITATION SOURCES." },
          url: { type: "string", description: "Empty string when there is no URL." },
          field: { type: "string", description: "Which field the phrase came from." },
          phrase: { type: "string", description: "Exact or faithfully normalized source text." },
        },
      },
    },

    personal_brand: signalBlock(),

    audience: {
      type: "object",
      additionalProperties: false,
      required: ["label", "value", "evidence_ids"],
      properties: {
        label: { type: "string", enum: ["none", "broad", "inferred", "specific", "explicit"] },
        value: { type: "string", description: "The ideal client. Empty string if unknown." },
        evidence_ids: ids,
      },
    },

    transformation: signalBlock(
      {
        label: {
          type: "string",
          enum: ["none", "inspirational", "expertise_only", "implied_result", "explicit_result"],
        },
        outcome: str,
      },
      ["label", "outcome"],
    ),

    information_funnel: signalBlock(
      {
        label: {
          type: "string",
          enum: ["none", "weak_education", "indirect_funnel", "visible_offer", "explicit_offer"],
        },
        asset_or_offer: str,
      },
      ["label", "asset_or_offer"],
    ),

    conversion_cta: signalBlock(
      {
        label: {
          type: "string",
          enum: ["none", "audience_only", "information_action", "commercial_action", "direct_sales_action"],
        },
        action: str,
        token_or_asset: { type: "string", description: "DM/comment keyword or named asset." },
      },
      ["label", "action", "token_or_asset"],
    ),

    primary_visitor_outcome: {
      type: "string",
      enum: VISITOR_OUTCOMES,
      description:
        'What the visitor ULTIMATELY receives after the CTA chain resolves. Use "unknown" if it cannot be established.',
    },

    proof: signalBlock(),

    authority: signalBlock({ types: { type: "array", items: str } }, ["types"]),

    named_mechanisms: {
      type: "array",
      items: str,
      description:
        'Named methods, frameworks, systems, programs, academies, or challenges they own, as "kind:name" (e.g. "program:Client Acceleration").',
    },

    offer_inventory: {
      type: "array",
      description: "Every commercially relevant offer, each evaluated independently.",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "offer_id", "name", "type", "prominence", "audience", "delivery",
          "customer_implementation_role", "price", "cta", "evidence_ids",
        ],
        properties: {
          offer_id: str,
          name: str,
          type: { type: "string", enum: OFFER_TYPES },
          prominence: { type: "string", enum: PROMINENCE },
          audience: str,
          delivery: { type: "string", description: "How the customer receives it." },
          customer_implementation_role: { type: "string", enum: IMPLEMENTATION_ROLES },
          price: str,
          cta: str,
          evidence_ids: ids,
        },
      },
    },

    proof_inventory: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "proof_id", "claim", "beneficiary", "result_type", "currency",
          "attributed_offer_id", "self_reported", "evidence_ids",
        ],
        properties: {
          proof_id: str,
          claim: str,
          beneficiary: {
            type: "string",
            enum: BENEFICIARIES,
            description: 'Who got the result. Use "unknown" rather than guessing.',
          },
          result_type: { type: "string", enum: RESULT_TYPES },
          currency: str,
          attributed_offer_id: { type: "string", description: "An offer_id, or empty string." },
          self_reported: { type: "boolean" },
          evidence_ids: ids,
        },
      },
    },

    primary_offer: {
      type: "object",
      additionalProperties: false,
      required: ["offer_id", "rationale"],
      properties: {
        offer_id: { type: "string", description: "An offer_id from offer_inventory, or empty string." },
        rationale: str,
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
      required: ["service_delivery_ids", "team_performance_ids", "service_cta_ids", "reliability"],
      properties: {
        service_delivery_ids: ids,
        team_performance_ids: ids,
        service_cta_ids: ids,
        reliability: {
          type: "string",
          enum: ["reliable", "incomplete", "absent"],
          description:
            '"reliable" requires at least two corroborating components, one explicit about done-for-you delivery. The isolated word "agency" is never enough.',
        },
      },
    },

    independent_information_offer_evidence: {
      type: "object",
      additionalProperties: false,
      required: [
        "own_audience", "own_transformation", "own_cta_path",
        "information_delivery", "sufficient_prominence", "evidence_ids",
      ],
      description:
        "Only meaningful when an agency service is also present. Report each component independently; application code decides whether the exception passes.",
      properties: {
        own_audience: { type: "string", enum: SIGNAL_STATES },
        own_transformation: { type: "string", enum: SIGNAL_STATES },
        own_cta_path: { type: "string", enum: SIGNAL_STATES },
        information_delivery: { type: "string", enum: SIGNAL_STATES },
        sufficient_prominence: { type: "string", enum: SIGNAL_STATES },
        evidence_ids: ids,
      },
    },

    conflicts: { type: "array", items: str },
    unknowns: {
      type: "array",
      items: str,
      description: "Anything that could not be established. Unknown is never absence.",
    },

    acquisition_observations: {
      type: "object",
      additionalProperties: false,
      required: ["cta_chain_resolved", "acquisition_sufficiency", "data_quality", "unknown_surfaces"],
      properties: {
        cta_chain_resolved: { type: "boolean" },
        acquisition_sufficiency: { type: "string", enum: ["sufficient", "partial", "insufficient"] },
        data_quality: { type: "string", enum: ["complete", "partial", "unreliable"] },
        unknown_surfaces: { type: "array", items: str },
      },
    },
  },
} as const;

/*
 * The contract is issued as TWO structured calls, not one.
 *
 * The whole field set compiles to a grammar the structured-output backend
 * rejects as too large — it accepts roughly eleven top-level fields. Splitting
 * along the natural seam (what the profile SAYS vs what it SELLS) keeps strict
 * schema enforcement on every field instead of falling back to prompt-only JSON,
 * and each pass gets a tighter, more focused instruction. Both passes read the
 * same evidence packet, so the second is largely a prompt-cache hit.
 *
 * Each pass carries its OWN citations table; indexes are pass-local and are
 * resolved separately before the two halves are merged.
 */
const SIGNAL_FIELDS = [
  "citations", "personal_brand", "audience", "transformation", "information_funnel",
  "conversion_cta", "primary_visitor_outcome", "proof", "authority", "named_mechanisms",
] as const;

const COMMERCE_FIELDS = [
  "citations", "offer_inventory", "proof_inventory", "primary_offer",
  "primary_offer_delivery", "done_for_you_service_evidence",
  "independent_information_offer_evidence", "conflicts", "unknowns",
  "acquisition_observations",
] as const;

function subsetSchema(fields: readonly string[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const field of fields) {
    properties[field] = (FIELD_CATALOGUE.properties as Record<string, unknown>)[field];
  }
  return { type: "object", additionalProperties: false, required: [...fields], properties };
}

export const SIGNALS_JSON_SCHEMA = subsetSchema(SIGNAL_FIELDS);
export const COMMERCE_JSON_SCHEMA = subsetSchema(COMMERCE_FIELDS);

/** Retained for schema-size diagnostics; never sent as one request. */
export const EXTRACTION_JSON_SCHEMA = FIELD_CATALOGUE;

// ---------------------------------------------------------------------------
// Zod re-validation of the raw (reference-based) response
// ---------------------------------------------------------------------------

/*
 * The JSON Schema uses "" rather than null for absent strings, because the
 * structured-output compiler caps union-typed parameters. Normalize back to null
 * so the rest of the pipeline sees one representation.
 */
const nullableString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().nullable().default(null),
);

const idList = z.array(z.number().int().nonnegative()).default([]);

function signalZod<T extends z.ZodRawShape>(extra: T) {
  return z
    .object({
      state: signalStateSchema,
      strength: signalStrengthSchema,
      evidence_ids: idList,
      ...extra,
    })
    .strict();
}

const citationTable = z
      .array(
        z
          .object({
            source_type: evidenceSourceTypeSchema,
            source_id: z.string().min(1),
            url: nullableString,
            field: z.string().default("unspecified"),
            phrase: z.string().default(""),
          })
          .strict(),
      )
  .default([]);

export const signalsExtractionSchema = z
  .object({
    citations: citationTable,
    personal_brand: signalZod({}),
    audience: z
      .object({
        label: z.enum(["none", "broad", "inferred", "specific", "explicit"]),
        value: nullableString,
        evidence_ids: idList,
      })
      .strict(),
    transformation: signalZod({
      label: z.enum(["none", "inspirational", "expertise_only", "implied_result", "explicit_result"]),
      outcome: nullableString,
    }),
    information_funnel: signalZod({
      label: z.enum(["none", "weak_education", "indirect_funnel", "visible_offer", "explicit_offer"]),
      asset_or_offer: nullableString,
    }),
    conversion_cta: signalZod({
      label: z.enum(["none", "audience_only", "information_action", "commercial_action", "direct_sales_action"]),
      action: nullableString,
      token_or_asset: nullableString,
    }),
    primary_visitor_outcome: visitorOutcomeSchema,
    proof: signalZod({}),
    authority: signalZod({ types: z.array(z.string()).default([]) }),
    named_mechanisms: z.array(z.string()).default([]),
  })
  .strict();

export const commerceExtractionSchema = z
  .object({
    citations: citationTable,
    offer_inventory: z
      .array(
        z
          .object({
            offer_id: z.string().min(1),
            name: nullableString,
            type: offerTypeSchema,
            prominence: prominenceSchema,
            audience: nullableString,
            delivery: nullableString,
            customer_implementation_role: customerImplementationRoleSchema,
            price: nullableString,
            cta: nullableString,
            evidence_ids: idList,
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
            currency: nullableString,
            attributed_offer_id: nullableString,
            self_reported: z.boolean().default(true),
            evidence_ids: idList,
          })
          .strict(),
      )
      .default([]),

    primary_offer: z.object({ offer_id: nullableString, rationale: nullableString }).strict(),
    primary_offer_delivery: z.enum(PRIMARY_OFFER_DELIVERY),

    done_for_you_service_evidence: z
      .object({
        service_delivery_ids: idList,
        team_performance_ids: idList,
        service_cta_ids: idList,
        reliability: z.enum(["reliable", "incomplete", "absent"]),
      })
      .strict(),

    independent_information_offer_evidence: z
      .object({
        own_audience: signalStateSchema,
        own_transformation: signalStateSchema,
        own_cta_path: signalStateSchema,
        information_delivery: signalStateSchema,
        sufficient_prominence: signalStateSchema,
        evidence_ids: idList,
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
  })
  .strict();

export type SignalsExtraction = z.infer<typeof signalsExtractionSchema>;
export type CommerceExtraction = z.infer<typeof commerceExtractionSchema>;

/** The merged view the adapter consumes, with both citation tables resolved. */
export type HaikuExtraction = SignalsExtraction & CommerceExtraction;

/*
 * Merge the two passes into one contract.
 *
 * Each pass numbered its citations independently, so the commerce table is
 * appended after the signals table and every commerce reference is shifted by
 * that offset. Without the shift, commerce evidence would silently resolve to
 * whatever the signals pass happened to put at the same index — the kind of bug
 * that produces confident, well-formed, completely wrong citations.
 */
export function mergeHaikuExtractions(
  signals: SignalsExtraction,
  commerce: CommerceExtraction,
): HaikuExtraction {
  const offset = signals.citations.length;
  const shift = (references: number[]): number[] => references.map((index) => index + offset);

  return {
    citations: [...signals.citations, ...commerce.citations],

    personal_brand: signals.personal_brand,
    audience: signals.audience,
    transformation: signals.transformation,
    information_funnel: signals.information_funnel,
    conversion_cta: signals.conversion_cta,
    primary_visitor_outcome: signals.primary_visitor_outcome,
    proof: signals.proof,
    authority: signals.authority,
    named_mechanisms: signals.named_mechanisms,

    offer_inventory: commerce.offer_inventory.map((offer) => ({
      ...offer,
      evidence_ids: shift(offer.evidence_ids),
    })),
    proof_inventory: commerce.proof_inventory.map((proof) => ({
      ...proof,
      evidence_ids: shift(proof.evidence_ids),
    })),
    primary_offer: commerce.primary_offer,
    primary_offer_delivery: commerce.primary_offer_delivery,
    done_for_you_service_evidence: {
      service_delivery_ids: shift(commerce.done_for_you_service_evidence.service_delivery_ids),
      team_performance_ids: shift(commerce.done_for_you_service_evidence.team_performance_ids),
      service_cta_ids: shift(commerce.done_for_you_service_evidence.service_cta_ids),
      reliability: commerce.done_for_you_service_evidence.reliability,
    },
    independent_information_offer_evidence: {
      ...commerce.independent_information_offer_evidence,
      evidence_ids: shift(commerce.independent_information_offer_evidence.evidence_ids),
    },
    conflicts: commerce.conflicts,
    unknowns: commerce.unknowns,
    acquisition_observations: commerce.acquisition_observations,
  };
}

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

const PROMINENCE_RANK: Record<OfferProminence, number> = { primary: 3, secondary: 2, incidental: 1 };

/*
 * What a visitor receives is implied by the offer type, so it is derived rather
 * than asked for — every enum repeated in the schema costs compiled-grammar
 * budget, and this one carried no information the type did not already give us.
 */
const OFFER_TYPE_TO_OUTCOMES: Record<string, VisitorOutcome[]> = {
  coaching: ["coaching"],
  information_product: ["information_product", "education"],
  community: ["community"],
  membership: ["membership"],
  event: ["event"],
  done_with_you_consulting: ["coaching", "education"],
  done_for_you_service: ["done_for_you_service"],
  managed_trading: ["managed_trading"],
  signals_service: ["signals_service"],
  affiliate_offer: ["affiliate_offer"],
  commerce_product: ["commerce_product"],
  software: ["software"],
  employment: ["employment_opportunity"],
  unknown: ["unknown"],
};

/*
 * Business models are DERIVED here rather than asked of the model. Haiku reports
 * offers and how the primary one is delivered; deterministic code turns that into
 * the model/prominence structure the track classifier consumes. Asking Haiku for
 * the business model directly would hand it a classification decision the spec
 * reserves for application code.
 */
export function deriveBusinessModels(
  extraction: HaikuExtraction,
  resolve: (idList: number[]) => EvidenceCitation[],
): BusinessModelFact[] {
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
    record(OFFER_TYPE_TO_MODEL[offer.type] ?? "unknown", offer.prominence, resolve(offer.evidence_ids));
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
    const evidence = primaryOffer
      ? resolve(primaryOffer.evidence_ids)
      : extraction.primary_offer_delivery === "done_for_you_service"
        ? resolve(extraction.done_for_you_service_evidence.service_delivery_ids)
        : resolve(extraction.information_funnel.evidence_ids);

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
  // "unknown" is the schema's way of saying the outcome could not be
  // established; the internal contract expresses that as null.
  const primaryOutcome =
    extraction.primary_visitor_outcome === "unknown" ? null : extraction.primary_visitor_outcome;

  const table = extraction.citations;
  const resolve = (references: number[]): EvidenceCitation[] =>
    [...new Set(references)]
      .map((index) => table[index])
      .filter((citation): citation is (typeof table)[number] => Boolean(citation))
      .map((citation) => ({
        source_type: citation.source_type,
        /*
         * The allowed-sources list is rendered as "type:id", and the model
         * sometimes copies the whole key into source_id. Stripping a leading
         * duplicate type prefix is a faithful reading of what it meant, not an
         * invented citation — the id still has to resolve against the snapshot.
         */
        source_id: citation.source_id.startsWith(`${citation.source_type}:`)
          ? citation.source_id.slice(citation.source_type.length + 1)
          : citation.source_id,
        url: citation.url,
        field: citation.field,
        phrase: citation.phrase,
      }));

  const offers: OfferEvidence[] = extraction.offer_inventory.map((offer) => ({
    offer_id: offer.offer_id,
    name: offer.name,
    type: offer.type,
    prominence: offer.prominence,
    audience: offer.audience,
    delivery: offer.delivery,
    visitor_receives: OFFER_TYPE_TO_OUTCOMES[offer.type] ?? ["unknown"],
    customer_implementation_role: offer.customer_implementation_role,
    price: offer.price,
    cta: offer.cta,
    evidence: resolve(offer.evidence_ids),
  }));

  const proofClaims = extraction.proof_inventory.map((proof) => ({
    proof_id: proof.proof_id,
    claim: proof.claim,
    beneficiary: proof.beneficiary,
    result_type: proof.result_type,
    value: null,
    currency: proof.currency,
    attributed_offer_id: proof.attributed_offer_id,
    producing_model: null,
    self_reported: proof.self_reported,
    evidence: resolve(proof.evidence_ids),
  }));

  const mechanismTypes = extraction.named_mechanisms.map((mechanism) => `named_mechanism:${mechanism}`);

  return {
    extraction_prompt_version: promptVersion,
    evidence_snapshot_id: snapshotId,

    human_personal_brand: {
      state: extraction.personal_brand.state,
      strength: extraction.personal_brand.strength,
      evidence: resolve(extraction.personal_brand.evidence_ids),
    },
    audience: {
      label: extraction.audience.label,
      value: extraction.audience.value,
      evidence: resolve(extraction.audience.evidence_ids),
    },
    transformation: {
      state: extraction.transformation.state,
      strength: extraction.transformation.strength,
      label: extraction.transformation.label,
      outcome: extraction.transformation.outcome,
      evidence: resolve(extraction.transformation.evidence_ids),
    },
    information_funnel: {
      state: extraction.information_funnel.state,
      strength: extraction.information_funnel.strength,
      label: extraction.information_funnel.label,
      // Derived from the resolved ultimate outcome rather than asked for twice.
      visitor_receives: primaryOutcome ? [primaryOutcome] : [],
      asset_or_offer: extraction.information_funnel.asset_or_offer,
      evidence: resolve(extraction.information_funnel.evidence_ids),
    },
    cta: {
      state: extraction.conversion_cta.state,
      strength: extraction.conversion_cta.strength,
      label: extraction.conversion_cta.label,
      action: extraction.conversion_cta.action,
      token_or_asset: extraction.conversion_cta.token_or_asset,
      evidence: resolve(extraction.conversion_cta.evidence_ids),
    },
    proof: {
      state: extraction.proof.state,
      strength: extraction.proof.strength,
      label: extraction.proof.strength,
      claims: proofClaims,
      evidence: resolve(extraction.proof.evidence_ids),
    },
    authority: {
      state: extraction.authority.state,
      strength: extraction.authority.strength,
      label: extraction.authority.strength,
      // Named mechanisms are authority evidence: they show why this person can
      // teach the subject. They are not a separate scoring dimension.
      types: [...extraction.authority.types, ...mechanismTypes],
      evidence: resolve(extraction.authority.evidence_ids),
    },

    business_models: deriveBusinessModels(extraction, resolve),
    offers,
    proof_attribution: proofClaims,

    primary_visitor_outcome: primaryOutcome,
    primary_cta: extraction.conversion_cta.action,
    ultimate_cta:
      offers.find((offer) => offer.offer_id === extraction.primary_offer.offer_id)?.cta ?? null,
    cta_chain_resolved: extraction.acquisition_observations.cta_chain_resolved,
    acquisition_sufficiency: extraction.acquisition_observations.acquisition_sufficiency,

    agency_evidence_bundle: {
      service_delivery: resolve(extraction.done_for_you_service_evidence.service_delivery_ids),
      team_performance: resolve(extraction.done_for_you_service_evidence.team_performance_ids),
      service_cta: resolve(extraction.done_for_you_service_evidence.service_cta_ids),
      reliability: extraction.done_for_you_service_evidence.reliability,
    },
    agency_service_evidence: resolve(extraction.done_for_you_service_evidence.service_delivery_ids),
    exclusion_evidence: [],
    conflicts: extraction.conflicts,
    data_quality: extraction.acquisition_observations.data_quality,
    unknown_surfaces: [
      ...extraction.acquisition_observations.unknown_surfaces,
      ...extraction.unknowns,
    ],

    independent_information_offer: {
      own_audience: extraction.independent_information_offer_evidence.own_audience,
      own_transformation: extraction.independent_information_offer_evidence.own_transformation,
      own_cta_path: extraction.independent_information_offer_evidence.own_cta_path,
      information_delivery: extraction.independent_information_offer_evidence.information_delivery,
      sufficient_prominence: extraction.independent_information_offer_evidence.sufficient_prominence,
      evidence: resolve(extraction.independent_information_offer_evidence.evidence_ids),
    },
    named_mechanisms: extraction.named_mechanisms.map((mechanism) => {
      const [kind, ...rest] = mechanism.split(":");
      const name = rest.join(":").trim();
      return {
        name: name || mechanism,
        kind: (name ? kind.trim() : "other") as "method" | "other",
        evidence: [],
      };
    }),
  };
}

/*
 * The rule structured output cannot express: an affirmative reading of the
 * evidence must point at something. Runs after references resolve, so a citation
 * index pointing at nothing is caught here rather than silently dropped.
 */
export function validateAffirmativeCitations(extraction: CommercialExtraction): string[] {
  const problems: string[] = [];

  const check = (
    name: string,
    block: { state: string; strength: string; evidence: EvidenceCitation[] },
  ) => {
    const affirmative = block.state === "present" || block.state === "conflicting";
    if (affirmative && block.evidence.length === 0) {
      problems.push(`${name}.state is "${block.state}" but no resolvable evidence was cited`);
    }
    if (block.strength !== "absent" && block.evidence.length === 0) {
      problems.push(`${name}.strength is "${block.strength}" but no resolvable evidence was cited`);
    }
    if (block.state === "absent" && block.strength !== "absent") {
      problems.push(`${name} cannot be absent with strength "${block.strength}"`);
    }
  };

  check("personal_brand", extraction.human_personal_brand);
  check("transformation", extraction.transformation);
  check("information_funnel", extraction.information_funnel);
  check("conversion_cta", extraction.cta);
  check("proof", extraction.proof);
  check("authority", extraction.authority);

  if (extraction.audience.label !== "none" && extraction.audience.evidence.length === 0) {
    problems.push(
      `audience.label is "${extraction.audience.label}" but no resolvable evidence was cited`,
    );
  }

  const bundle = extraction.agency_evidence_bundle;
  if (
    bundle.reliability === "reliable" &&
    bundle.service_delivery.length === 0 &&
    bundle.team_performance.length === 0 &&
    bundle.service_cta.length === 0
  ) {
    problems.push("done_for_you_service_evidence is reliable but no component evidence was cited");
  }

  return problems;
}
