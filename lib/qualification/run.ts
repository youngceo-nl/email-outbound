/*
 * The single qualification orchestrator.
 *
 * Every entry point routes through this function so the same evidence always
 * produces the same decision regardless of which scrape or scoring path
 * discovered the lead. Dependencies are injected so the whole flow is testable
 * without touching the network.
 */

import { randomUUID } from "node:crypto";
import { collectCommercialEvidence } from "@/lib/evidence/collect";
import { createPageFetcher, DEFAULT_EXTERNAL_CONFIG, type ExternalCollectorConfig, type PageFetcher } from "@/lib/evidence/external";
import { collectYouTubeEvidence, type YouTubeConfig } from "@/lib/evidence/youtube";
import { assessSufficiency, type SufficiencyResult } from "@/lib/evidence/sufficiency";
import {
  ACQUISITION_VERSION,
  CHALLENGER_PROMPT_VERSION,
  CONFIG_VERSION,
  EXTRACTION_PROMPT_VERSION,
  PIPELINE_VERSION,
  SCORECARD_VERSION,
  VISION_PROMPT_VERSION,
} from "@/lib/evidence/versions";
import { extractCommercialEvidence, type ExtractionResult } from "./extract";
import { challengerTrigger, runChallenger, type ChallengerDecision } from "./challenger";
import { runVisualIdentity, type VisualIdentityResult } from "./visual-identity";
import { decideCommercialQualification, type FollowerRange } from "./decide";
import { ACTIVE_SCORECARD, type Scorecard } from "./scorecard";
import type { LlmClient } from "./providers";
import type {
  CommercialDecision,
  DecisionReasonCode,
  EvidenceSnapshot,
  InstagramEvidence,
} from "./types";

export type QualificationRunResult = {
  username: string;
  sufficiency: SufficiencyResult;
  snapshot: EvidenceSnapshot | null;
  extraction: ExtractionResult | null;
  /*
   * Gate 2's visual evidence (lib/qualification/visual-identity.ts). Facts
   * only — never null when acquisition ran, but `facts` inside it is null
   * when no images were captured. Turning this into a gate decision is a
   * follow-up plan; this pipeline stage only produces and stores the facts.
   */
  visual_identity: VisualIdentityResult | null;
  challenger: ChallengerDecision | null;
  challenger_trigger: string;
  decision: CommercialDecision;
  timings_ms: { acquisition: number; extraction: number; challenger: number; total: number };
  usage: { inputTokens: number; outputTokens: number };
};

export type QualificationDependencies = {
  fetchPage: PageFetcher;
  collectYouTube: typeof collectYouTubeEvidence;
  /** Primary extractor — Claude Haiku 4.5 in production. */
  llm: LlmClient;
  /*
   * Adversarial verifier. Deliberately a separate, stronger model: it only runs
   * on high-impact decisions, so the extra cost per lead is bounded while the
   * decisions that matter most get a second, more capable opinion.
   */
  challengerLlm: LlmClient;
  /** Vision-capable model for Gate 2's visual-identity pass. Defaults to the primary extractor's client. */
  visionLlm: LlmClient;
  now: () => string;
  uuid: () => string;
};

export type RunOptions = {
  instagram: InstagramEvidence;
  /** Replay a durable acquisition without contacting any acquisition surface. */
  precollectedSnapshot?: EvidenceSnapshot;
  llm: LlmClient;
  challengerLlm?: LlmClient;
  visionLlm?: LlmClient;
  leadId?: string | null;
  /*
   * Steel-rendered funnel and persisted images — see AcquisitionResult in
   * lib/instagram/steel-acquisition.ts and VisualEvidence in types.ts.
   * Ignored when precollectedSnapshot is set (that snapshot already carries
   * its own visual_evidence/rendered destinations, if any).
   */
  seedDestinations?: EvidenceSnapshot["external_destinations"];
  visualEvidence?: EvidenceSnapshot["visual_evidence"];
  external?: Partial<ExternalCollectorConfig>;
  youtube?: Partial<YouTubeConfig>;
  scorecard?: Scorecard;
  followerRange?: FollowerRange;
  /** Force the challenger even when routing would not trigger it. */
  auditSample?: boolean;
  dependencies?: Partial<QualificationDependencies>;
};

export async function runCommercialQualification(
  opts: RunOptions,
): Promise<QualificationRunResult> {
  const started = Date.now();
  const externalConfig = { ...DEFAULT_EXTERNAL_CONFIG, ...opts.external };
  const deps: QualificationDependencies = {
    fetchPage: opts.dependencies?.fetchPage ?? createPageFetcher(),
    collectYouTube: opts.dependencies?.collectYouTube ?? collectYouTubeEvidence,
    llm: opts.dependencies?.llm ?? opts.llm,
    challengerLlm:
      opts.dependencies?.challengerLlm ?? opts.challengerLlm ?? opts.dependencies?.llm ?? opts.llm,
    visionLlm: opts.dependencies?.visionLlm ?? opts.visionLlm ?? opts.dependencies?.llm ?? opts.llm,
    now: opts.dependencies?.now ?? (() => new Date().toISOString()),
    uuid: opts.dependencies?.uuid ?? randomUUID,
  };

  const instagram = opts.instagram;
  const sufficiency = assessSufficiency(instagram);

  // ---- Pre-AI gates. Only reliable, ICP-independent facts may short-circuit. ----
  if (sufficiency.verdict === "excluded") {
    return terminalResult({
      username: instagram.username,
      sufficiency,
      outcome: "rejected",
      mode: "hard_excluded",
      reasons: ["universal_exclusion"],
      deps,
      started,
    });
  }
  if (sufficiency.verdict === "retryable") {
    return terminalResult({
      username: instagram.username,
      sufficiency,
      outcome: "data_retry",
      mode: "retry_required",
      reasons: [
        instagram.profile_capture_status === "captured" ? "unreliable_data" : "profile_unavailable",
      ],
      deps,
      started,
    });
  }

  // ---- Acquisition ----
  const acquisitionStart = Date.now();
  const snapshot =
    opts.precollectedSnapshot ??
    (await collectCommercialEvidence({
      instagram,
      dataQuality: sufficiency.data_quality,
      leadId: opts.leadId,
      external: externalConfig,
      youtube: opts.youtube,
      seedDestinations: opts.seedDestinations,
      visualEvidence: opts.visualEvidence,
      dependencies: {
        fetchPage: deps.fetchPage,
        collectYouTube: deps.collectYouTube,
        now: deps.now,
        uuid: deps.uuid,
      },
    }));
  const acquisitionMs = opts.precollectedSnapshot ? 0 : Date.now() - acquisitionStart;

  // ---- Visual identity (Gate 2's evidence) — facts only, never a decision. ----
  const visualIdentity = await runVisualIdentity({ snapshot, llm: deps.visionLlm });

  // ---- Extraction ----
  const extractionStart = Date.now();
  const extraction = await extractCommercialEvidence({ snapshot, llm: deps.llm });
  const extractionMs = Date.now() - extractionStart;

  if (!extraction.ok) {
    /*
     * Invalid model output is a scoring error, never a rejection. Rejecting here
     * would silently convert an infrastructure failure into a lost lead.
     */
    const result = terminalResult({
      username: instagram.username,
      sufficiency,
      outcome: "review",
      mode: "manual_review",
      reasons: ["ai_output_invalid"],
      deps,
      started,
      snapshot,
    });
    return {
      ...result,
      extraction,
      visual_identity: visualIdentity,
      timings_ms: { acquisition: acquisitionMs, extraction: extractionMs, challenger: 0, total: Date.now() - started },
      usage: extraction.usage,
    };
  }

  // ---- Provisional decision, to learn whether the challenger is warranted ----
  const provisional = decideCommercialQualification({
    snapshot,
    extraction: extraction.extraction,
    visualIdentity,
    challenger: null,
    challengerAgrees: null,
    citationWarnings: extraction.citation_warnings,
    scorecard: opts.scorecard ?? ACTIVE_SCORECARD,
    followerRange: opts.followerRange,
    now: deps.now,
  });

  const trigger = challengerTrigger({
    // Certainty cannot reach `high` before the challenger runs, so the test is
    // "would this auto-approve if the challenger agreed?", not the literal flag.
    // `qualification` is already the raw, challenger-independent tier.
    proposedAutoApproval: provisional.qualification === "QUALIFIED_HIGH_PRIORITY",
    trackMixed: provisional.review_flags.includes("agency_information_mixed"),
    conflicts: extraction.extraction.conflicts.length,
    hardExclusion: provisional.hard_exclusion,
    acquisitionFailed: snapshot.acquisition_sufficiency === "insufficient",
    auditSample: opts.auditSample,
  });

  let challenger: ChallengerDecision | null = null;
  let challengerMs = 0;
  if (trigger !== "none") {
    const challengerStart = Date.now();
    challenger = await runChallenger({
      snapshot,
      extraction: extraction.extraction,
      llm: deps.challengerLlm,
    });
    challengerMs = Date.now() - challengerStart;
  }

  const decision = decideCommercialQualification({
    snapshot,
    extraction: extraction.extraction,
    visualIdentity,
    challenger: challenger?.result ?? null,
    challengerAgrees: challenger?.agrees ?? null,
    citationWarnings: extraction.citation_warnings,
    scorecard: opts.scorecard ?? ACTIVE_SCORECARD,
    followerRange: opts.followerRange,
    now: deps.now,
  });

  return {
    username: instagram.username,
    sufficiency,
    snapshot,
    extraction,
    visual_identity: visualIdentity,
    challenger,
    challenger_trigger: trigger,
    decision,
    timings_ms: {
      acquisition: acquisitionMs,
      extraction: extractionMs,
      challenger: challengerMs,
      total: Date.now() - started,
    },
    usage: extraction.usage,
  };
}

/*
 * Replay a stored snapshot through extraction and decisioning with no
 * acquisition at all.
 *
 * This is what makes the immutable snapshot worth storing: a new prompt version,
 * a new scorecard, or a different model can be evaluated against exactly the
 * bytes that produced an earlier decision — no re-scraping, no drift, and no
 * dependency on the profile still looking the way it did.
 */
export async function requalifyFromSnapshot(opts: {
  snapshot: EvidenceSnapshot;
  llm: LlmClient;
  challengerLlm?: LlmClient;
  visionLlm?: LlmClient;
  scorecard?: Scorecard;
  followerRange?: FollowerRange;
  auditSample?: boolean;
  now?: () => string;
}): Promise<QualificationRunResult> {
  const started = Date.now();
  const now = opts.now ?? (() => new Date().toISOString());
  const challengerLlm = opts.challengerLlm ?? opts.llm;
  const scorecard = opts.scorecard ?? ACTIVE_SCORECARD;
  const snapshot = opts.snapshot;

  const sufficiency = assessSufficiency(snapshot.instagram);

  // Replays against the stored images too — a new vision-prompt version can be
  // evaluated against exactly the same bytes, same as text extraction.
  const visualIdentity = await runVisualIdentity({ snapshot, llm: opts.visionLlm ?? opts.llm });

  const extractionStart = Date.now();
  const extraction = await extractCommercialEvidence({ snapshot, llm: opts.llm });
  const extractionMs = Date.now() - extractionStart;

  if (!extraction.ok) {
    const result = terminalResult({
      username: snapshot.username,
      sufficiency,
      outcome: "review",
      mode: "manual_review",
      reasons: ["ai_output_invalid"],
      deps: { now } as QualificationDependencies,
      started,
      snapshot,
    });
    return {
      ...result,
      extraction,
      visual_identity: visualIdentity,
      timings_ms: { acquisition: 0, extraction: extractionMs, challenger: 0, total: Date.now() - started },
      usage: extraction.usage,
    };
  }

  const provisional = decideCommercialQualification({
    snapshot,
    extraction: extraction.extraction,
    visualIdentity,
    challenger: null,
    challengerAgrees: null,
    citationWarnings: extraction.citation_warnings,
    scorecard,
    followerRange: opts.followerRange,
    now,
  });

  const trigger = challengerTrigger({
    proposedAutoApproval: provisional.qualification === "QUALIFIED_HIGH_PRIORITY",
    trackMixed: provisional.review_flags.includes("agency_information_mixed"),
    conflicts: extraction.extraction.conflicts.length,
    hardExclusion: provisional.hard_exclusion,
    acquisitionFailed: snapshot.acquisition_sufficiency === "insufficient",
    auditSample: opts.auditSample,
  });

  let challenger: ChallengerDecision | null = null;
  let challengerMs = 0;
  if (trigger !== "none") {
    const challengerStart = Date.now();
    challenger = await runChallenger({ snapshot, extraction: extraction.extraction, llm: challengerLlm });
    challengerMs = Date.now() - challengerStart;
  }

  const decision = decideCommercialQualification({
    snapshot,
    extraction: extraction.extraction,
    visualIdentity,
    challenger: challenger?.result ?? null,
    challengerAgrees: challenger?.agrees ?? null,
    citationWarnings: extraction.citation_warnings,
    scorecard,
    followerRange: opts.followerRange,
    now,
  });

  return {
    username: snapshot.username,
    sufficiency,
    snapshot,
    extraction,
    visual_identity: visualIdentity,
    challenger,
    challenger_trigger: trigger,
    decision,
    timings_ms: { acquisition: 0, extraction: extractionMs, challenger: challengerMs, total: Date.now() - started },
    usage: extraction.usage,
  };
}

// ---------------------------------------------------------------------------
// Terminal results that never reached the model
// ---------------------------------------------------------------------------

function terminalResult(args: {
  username: string;
  sufficiency: SufficiencyResult;
  outcome: CommercialDecision["decision"];
  mode: CommercialDecision["mode"];
  reasons: DecisionReasonCode[];
  deps: QualificationDependencies;
  started: number;
  snapshot?: EvidenceSnapshot;
}): QualificationRunResult {
  const emptyStates = {
    information_funnel: "unknown" as const,
    proof: "unknown" as const,
    authority: "unknown" as const,
    transformation: "unknown" as const,
    cta: "unknown" as const,
    human_personal_brand: "unknown" as const,
  };

  return {
    username: args.username,
    sufficiency: args.sufficiency,
    snapshot: args.snapshot ?? null,
    extraction: null,
    visual_identity: null,
    challenger: null,
    challenger_trigger: "none",
    decision: {
      scorecard_version: SCORECARD_VERSION,
      evidence_snapshot_id: args.snapshot?.snapshot_id ?? "none",
      extraction_id: null,
      track: "uncertain",
      icp_eligible: args.outcome !== "rejected",
      hard_exclusion: args.outcome === "rejected",
      rejection_reason: args.outcome === "rejected" ? args.reasons[0] : null,
      signal_states: emptyStates,
      primary_visitor_outcome: null,
      scores: {
        buyer_clarity: 0,
        transformation_clarity: 0,
        information_funnel_evidence: 0,
        conversion_intent: 0,
        proof_strength: 0,
        authority_strength: 0,
        proof_maturity: 0,
        commercial_fit: 0,
      },
      score_components: {},
      certainty: args.outcome === "rejected" ? "high" : "low",
      challenger_agreement: null,
      challenger_result: null,
      decision: args.outcome,
      mode: args.mode,
      automatic_approval_eligible: false,
      decision_reasons: args.reasons,
      review_flags: args.sufficiency.data_quality === "unreliable" ? ["unreliable_data"] : [],
      priority: null,
      versions: {
        acquisition_version: ACQUISITION_VERSION,
        extraction_prompt_version: EXTRACTION_PROMPT_VERSION,
        challenger_prompt_version: CHALLENGER_PROMPT_VERSION,
        scorecard_version: SCORECARD_VERSION,
        config_version: CONFIG_VERSION,
        pipeline_version: PIPELINE_VERSION,
        vision_prompt_version: VISION_PROMPT_VERSION,
      },
      decided_at: args.deps.now(),
    },
    timings_ms: { acquisition: 0, extraction: 0, challenger: 0, total: Date.now() - args.started },
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}
