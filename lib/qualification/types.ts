/*
 * Canonical contracts for commercial lead qualification.
 *
 * Spec: docs/superpowers/specs/2026-07-31-commercial-lead-qualification-design.md
 *
 * Deliberately free of `server-only` so the rules stay runnable under
 * `tsx --test` and the CLI harness. Nothing here touches the network.
 */

// ---------------------------------------------------------------------------
// Capture state
// ---------------------------------------------------------------------------

/*
 * The distinction the whole spec rests on: `captured` with an empty payload
 * means "we looked and there was nothing". The other three mean "we do not
 * know". Automatic rejection may never be derived from the latter three.
 */
export type CaptureStatus = "captured" | "unavailable" | "failed" | "not_attempted";

export const UNKNOWN_CAPTURE_STATUSES: readonly CaptureStatus[] = [
  "unavailable",
  "failed",
  "not_attempted",
];

export function isUnknownCapture(status: CaptureStatus): boolean {
  return status !== "captured";
}

// ---------------------------------------------------------------------------
// Evidence citation
// ---------------------------------------------------------------------------

export type EvidenceSourceType =
  | "display_name"
  | "bio"
  | "instagram_metadata"
  | "highlight"
  | "link_hub"
  | "external_page"
  | "youtube_channel"
  | "youtube_video"
  | "pinned_post"
  | "recent_post";

export type EvidenceCitation = {
  source_type: EvidenceSourceType;
  source_id: string;
  url: string | null;
  field: string;
  phrase: string;
};

// ---------------------------------------------------------------------------
// Instagram evidence
// ---------------------------------------------------------------------------

export type InstagramPostEvidence = {
  post_id: string;
  caption: string | null;
  taken_at: string | null;
  is_video: boolean;
  is_pinned: boolean;
  likes: number | null;
  comments: number | null;
  views: number | null;
};

export type InstagramProfileExtractionMethod =
  | "visible_dom"
  | "metadata_fallback"
  | "provider"
  | "combined";

/*
 * Which concrete acquisition path served a profile. Distinct from
 * InstagramProfileExtractionMethod, which describes the SHAPE of the parse:
 * Apify and the ScrapingBee web_profile_info endpoint are both "provider", so
 * the extraction method alone cannot tell them apart when a run misbehaves.
 */
export type AcquisitionSource =
  | "apify"
  | "scrapingbee_web_profile_info"
  | "scrapingbee_metadata";

export type InstagramEvidence = {
  username: string;
  display_name: string | null;
  category: string | null;
  bio: string | null;
  external_link: string | null;
  is_private: boolean;
  is_verified: boolean;
  followers: number | null;
  following: number | null;
  total_posts: number | null;
  instagram_meta_description: string | null;
  profile_extraction_method: InstagramProfileExtractionMethod;
  /* Optional so snapshots captured before this field existed still validate. */
  acquisition_source?: AcquisitionSource;

  profile_capture_status: CaptureStatus;
  profile_captured_at: string | null;
  /*
   * Separate from the value itself. The metadata fallback cannot see the bio
   * link at all, so a null link there means UNKNOWN — not "this profile has no
   * link". Conflating the two would let a fallback-acquired profile look like a
   * captured-and-empty external surface and wrongly reach high certainty.
   */
  external_link_capture_status: CaptureStatus;

  recent_posts: InstagramPostEvidence[];
  recent_posts_capture_status: CaptureStatus;

  pinned_posts: InstagramPostEvidence[];
  pinned_posts_capture_status: CaptureStatus;

  story_highlight_titles: string[];
  story_highlights_capture_status: CaptureStatus;
  story_highlights_captured_at: string | null;
};

// ---------------------------------------------------------------------------
// External destinations
// ---------------------------------------------------------------------------

export type DestinationType =
  | "application"
  | "booking"
  | "lead_magnet"
  | "education"
  | "youtube"
  | "link_hub"
  | "agency_service"
  | "community"
  | "store"
  | "unknown"
  | "none";

export type CommercialRelevance = "primary" | "supporting" | "incidental";

export type VisitorOutcome =
  | "education"
  | "coaching"
  | "information_product"
  | "community"
  | "live_instruction"
  | "membership"
  | "event"
  | "employment_opportunity"
  | "recruiting_service"
  | "done_for_you_service"
  | "managed_trading"
  | "signals_service"
  | "affiliate_offer"
  | "commerce_product"
  | "software"
  | "entertainment"
  | "unknown";

/*
 * Visitor outcomes that satisfy the spec's "primary visitor outcome is
 * information, education, coaching, community, live instruction, membership,
 * or an educational event" qualification condition (Step 6).
 */
export const INFORMATION_VISITOR_OUTCOMES: readonly VisitorOutcome[] = [
  "education",
  "coaching",
  "information_product",
  "community",
  "live_instruction",
  "membership",
  "event",
];

export type ExtractedCta = {
  label: string;
  url: string | null;
};

export type ExternalDestination = {
  destination_id: string;
  source_url: string;
  final_url: string | null;
  redirect_chain: string[];
  visible_label: string | null;
  page_title: string | null;
  meta_description: string | null;
  headings: string[];
  cta_labels: ExtractedCta[];
  offer_copy: string[];
  prices: string[];
  destination_type: DestinationType;
  /** Every type whose signals fired, preserved when the page is ambiguous. */
  candidate_types: DestinationType[];
  classification_state: "resolved" | "conflicting" | "unknown";
  form_signals: string[];
  service_delivery_signals: string[];
  education_delivery_signals: string[];
  proof_claims: string[];
  visitor_receives: VisitorOutcome[];
  commercial_relevance: CommercialRelevance;
  selection_reason: string;
  rank: number;
  hop: number;
  text_excerpt: string | null;
  capture_status: CaptureStatus;
  capture_method: "free_fetch" | "scrapingbee" | "none";
  captured_at: string | null;
  error: string | null;
};

// ---------------------------------------------------------------------------
// YouTube evidence
// ---------------------------------------------------------------------------

export type YouTubeVideoEvidence = {
  video_id: string;
  url: string;
  title: string;
  description: string | null;
  published_at: string | null;
  views: number | null;
  outbound_urls: string[];
  selection_reason: string;
  capture_status: CaptureStatus;
};

export type YouTubeChannelEvidence = {
  channel_id: string;
  url: string;
  name: string | null;
  handle: string | null;
  description: string | null;
  subscribers: number | null;
  video_count: number | null;
  outbound_urls: string[];
  recent_video_titles: string[];
  capture_status: CaptureStatus;
  captured_at: string | null;
  error: string | null;
};

// ---------------------------------------------------------------------------
// CTA chain
// ---------------------------------------------------------------------------

export type CtaHopSourceType =
  | "instagram_profile"
  | "link_hub"
  | "external_page"
  | "youtube_channel"
  | "youtube_video";

export type CtaHop = {
  hop: number;
  source_type: CtaHopSourceType;
  source_id: string;
  action: string;
  destination_url: string | null;
  visitor_receives: VisitorOutcome | null;
  evidence: string;
};

export type AcquisitionStopReason =
  | "ultimate_outcome_resolved"
  | "core_gate_resolved"
  | "reliable_exclusion_resolved"
  | "max_hops_reached"
  | "no_commercial_action"
  | "destination_unavailable"
  | "authentication_required"
  | "unsupported_page"
  | "no_external_link"
  | "budget_exhausted"
  | "cycle_detected"
  | "blocked"
  | "provider_failed"
  | "complete";

// ---------------------------------------------------------------------------
// Offers and proof
// ---------------------------------------------------------------------------

export type OfferType =
  | "coaching"
  | "information_product"
  | "community"
  | "membership"
  | "event"
  | "done_with_you_consulting"
  | "done_for_you_service"
  | "managed_trading"
  | "signals_service"
  | "affiliate_offer"
  | "commerce_product"
  | "software"
  | "employment"
  | "unknown";

export type OfferProminence = "primary" | "secondary" | "incidental";

export type CustomerImplementationRole =
  | "none"
  | "self_implemented"
  | "implements_with_guidance"
  | "team_implemented"
  | "unknown";

export type OfferEvidence = {
  offer_id: string;
  name: string | null;
  type: OfferType;
  prominence: OfferProminence;
  audience: string | null;
  delivery: string | null;
  visitor_receives: VisitorOutcome[];
  customer_implementation_role: CustomerImplementationRole;
  price: string | null;
  cta: string | null;
  evidence: EvidenceCitation[];
};

export type ProofBeneficiary =
  | "self"
  | "student"
  | "coaching_client"
  | "community_member"
  | "agency_client"
  | "software_customer"
  | "affiliate"
  | "unknown";

export type ProofResultType =
  | "revenue"
  | "clients_served"
  | "students_taught"
  | "people_helped"
  | "audience"
  | "testimonial"
  | "transformation"
  | "other";

export type ProofEvidence = {
  proof_id: string;
  claim: string;
  beneficiary: ProofBeneficiary;
  result_type: ProofResultType;
  value: number | null;
  currency: string | null;
  attributed_offer_id: string | null;
  producing_model: string | null;
  self_reported: boolean;
  evidence: EvidenceCitation[];
};

// ---------------------------------------------------------------------------
// Evidence snapshot
// ---------------------------------------------------------------------------

export type DataQuality = "complete" | "partial" | "unreliable";

export type AcquisitionSufficiency = "sufficient" | "partial" | "insufficient";

export type ActivityMetrics = {
  data_quality: DataQuality;
  median_unpinned_reel_views: number | null;
  reel_view_rate: number | null;
  posts_last_30_days: number | null;
  reels_last_30_days: number | null;
  days_since_latest_post: number | null;
  median_likes_per_follower: number | null;
};

export type UnknownSurface = {
  surface: string;
  capture_status: CaptureStatus;
  reason: string;
};

export type EvidenceSnapshot = {
  snapshot_id: string;
  lead_id: string | null;
  username: string;
  captured_at: string;

  instagram: InstagramEvidence;
  external_destinations: ExternalDestination[];
  external_capture_status: CaptureStatus;
  youtube_channels: YouTubeChannelEvidence[];
  youtube_videos: YouTubeVideoEvidence[];

  cta_chain: CtaHop[];
  primary_cta: string | null;
  ultimate_cta: string | null;

  offer_inventory_seed: OfferEvidence[];
  proof_inventory_seed: ProofEvidence[];
  /*
   * Deterministically detected DM/comment-keyword funnels. Surfaced as explicit
   * evidence because the extractor kept scoring them by what the visitor
   * receives rather than by how direct the action is.
   */
  direct_response_ctas: DirectResponseCtaEvidence[];

  acquisition_stop_reason: AcquisitionStopReason;
  acquisition_sufficiency: AcquisitionSufficiency;
  unknown_surfaces: UnknownSurface[];
  hops_used: number;

  activity: ActivityMetrics;
  versions: AcquisitionVersions;
};

export type DirectResponseCtaEvidence = {
  action: "dm" | "comment" | "apply" | "book";
  keyword: string | null;
  source: string;
  phrase: string;
};

export type AcquisitionVersions = {
  acquisition_version: string;
  fixture_revision: string;
};

// ---------------------------------------------------------------------------
// AI extraction contract
// ---------------------------------------------------------------------------

export type SignalState = "present" | "absent" | "unknown" | "conflicting";
export type SignalStrength = "absent" | "weak" | "credible" | "strong";

export type BuyerClarityLabel = "none" | "broad" | "inferred" | "specific" | "explicit";
export type TransformationLabel =
  | "none"
  | "inspirational"
  | "expertise_only"
  | "implied_result"
  | "explicit_result";
export type InformationFunnelLabel =
  | "none"
  | "weak_education"
  | "indirect_funnel"
  | "visible_offer"
  | "explicit_offer";
export type ConversionIntentLabel =
  | "none"
  | "audience_only"
  | "information_action"
  | "commercial_action"
  | "direct_sales_action";
export type ProofLabel = "absent" | "weak" | "credible" | "strong";

export type BusinessModelType =
  | "information_education"
  | "agency_service"
  | "commerce"
  | "saas"
  | "affiliate"
  | "employment"
  | "non_commercial"
  | "unknown";

export type BusinessModelFact = {
  type: BusinessModelType;
  prominence: OfferProminence;
  evidence: EvidenceCitation[];
};

export type AgencyEvidenceReliability = "reliable" | "incomplete" | "absent";

export type AgencyEvidenceBundle = {
  service_delivery: EvidenceCitation[];
  team_performance: EvidenceCitation[];
  service_cta: EvidenceCitation[];
  reliability: AgencyEvidenceReliability;
};

export type SignalBlock = {
  state: SignalState;
  strength: SignalStrength;
  evidence: EvidenceCitation[];
};

export type CommercialExtraction = {
  extraction_prompt_version: string;
  evidence_snapshot_id: string;

  human_personal_brand: SignalBlock;
  audience: {
    label: BuyerClarityLabel;
    value: string | null;
    evidence: EvidenceCitation[];
  };
  transformation: SignalBlock & {
    label: TransformationLabel;
    outcome: string | null;
  };
  information_funnel: SignalBlock & {
    label: InformationFunnelLabel;
    visitor_receives: VisitorOutcome[];
    asset_or_offer: string | null;
  };
  cta: SignalBlock & {
    label: ConversionIntentLabel;
    action: string | null;
    token_or_asset: string | null;
  };
  proof: SignalBlock & {
    label: ProofLabel;
    claims: ProofEvidence[];
  };
  authority: SignalBlock & {
    label: ProofLabel;
    types: string[];
  };

  business_models: BusinessModelFact[];
  offers: OfferEvidence[];
  proof_attribution: ProofEvidence[];

  primary_visitor_outcome: VisitorOutcome | null;
  primary_cta: string | null;
  ultimate_cta: string | null;
  cta_chain_resolved: boolean;
  acquisition_sufficiency: AcquisitionSufficiency;

  agency_evidence_bundle: AgencyEvidenceBundle;
  agency_service_evidence: EvidenceCitation[];
  exclusion_evidence: EvidenceCitation[];
  conflicts: string[];
  data_quality: DataQuality;
  unknown_surfaces: string[];

  /*
   * Component-wise evidence for the agency exception. The extractor reports each
   * component independently; deterministic code decides whether the exception
   * passes. Optional so extractions from older prompt versions still validate.
   */
  independent_information_offer?: IndependentInformationOfferEvidence;
  named_mechanisms?: NamedMechanism[];
};

export type IndependentInformationOfferEvidence = {
  own_audience: SignalState;
  own_transformation: SignalState;
  own_cta_path: SignalState;
  information_delivery: SignalState;
  sufficient_prominence: SignalState;
  evidence: EvidenceCitation[];
};

export type NamedMechanism = {
  name: string;
  kind:
    | "method"
    | "framework"
    | "system"
    | "program"
    | "academy"
    | "challenge"
    | "mechanism"
    | "other";
  evidence: EvidenceCitation[];
};

// ---------------------------------------------------------------------------
// Challenger
// ---------------------------------------------------------------------------

export type ChallengerConclusion =
  | "information_personal_brand"
  | "agency_service"
  | "uncertain";

export type ChallengerResult = {
  challenger_prompt_version: string;
  business_model_conclusion: ChallengerConclusion;
  primary_cta: string | null;
  ultimate_cta: string | null;
  visitor_receives: VisitorOutcome[];
  agency_evidence_bundle: AgencyEvidenceBundle;
  core_gate_passes: boolean;
  distinct_information_funnel: boolean;
  cta_chain_resolved: boolean;
  acquisition_sufficiency: AcquisitionSufficiency;
  signal_states: {
    information_funnel: SignalState;
    proof: SignalState;
    authority: SignalState;
    transformation: SignalState;
    cta: SignalState;
  };
  evidence: EvidenceCitation[];
  reason: string;
};

// ---------------------------------------------------------------------------
// Deterministic decision
// ---------------------------------------------------------------------------

export type CommercialTrack =
  | "information_personal_brand"
  | "agency_service"
  | "commerce"
  | "saas"
  | "affiliate"
  | "employment"
  | "non_commercial"
  | "uncertain";

export type Certainty = "high" | "medium" | "low";

export type DecisionOutcome = "qualified" | "review" | "rejected" | "data_retry";

export type DecisionMode =
  | "auto_approved"
  | "manual_review"
  | "hard_excluded"
  | "retry_required";

export type DecisionReasonCode =
  | "core_gate_passes"
  | "information_personal_brand"
  | "primary_offer_done_for_you_service"
  | "missing_core_evidence"
  | "core_signal_unknown"
  | "contradictory_evidence"
  | "unreliable_data"
  | "uncertain_track"
  | "excluded_track"
  | "score_below_threshold"
  | "score_in_review_band"
  | "challenger_disagreement"
  | "acquisition_insufficient"
  | "ai_output_invalid"
  | "universal_exclusion"
  | "agency_information_mixed"
  | "follower_range"
  | "private_profile"
  | "profile_unavailable";

export type ReviewFlag =
  | "agency_information_mixed"
  | "missing_core_evidence"
  | "contradictory_evidence"
  | "unreliable_data"
  | "uncertain_track"
  | "suspicious_proof"
  | "proof_unverified"
  | "authority_unverified"
  | "follower_range";

export type ScoreComponent = {
  value: number;
  label: string;
  reason: string;
  citations: EvidenceCitation[];
};

export type CommercialScores = {
  buyer_clarity: number;
  transformation_clarity: number;
  information_funnel_evidence: number;
  conversion_intent: number;
  proof_strength: number;
  authority_strength: number;
  proof_maturity: number;
  commercial_fit: number;
};

export type SignalStates = {
  information_funnel: SignalState;
  proof: SignalState;
  authority: SignalState;
  transformation: SignalState;
  cta: SignalState;
  human_personal_brand: SignalState;
};

export type PriorityScore = {
  value: number;
  data_completeness: "complete" | "partial" | "unknown";
  components: {
    commercial_fit: number;
    proof_maturity: number;
    reel_view_rate: number | null;
    posting_recency: number | null;
    posting_consistency: number | null;
  };
};

export type QualificationVersions = {
  acquisition_version: string;
  extraction_prompt_version: string;
  challenger_prompt_version: string;
  scorecard_version: string;
  config_version: string;
  pipeline_version: string;
};

export type CommercialDecision = {
  scorecard_version: string;
  evidence_snapshot_id: string;
  extraction_id: string | null;

  track: CommercialTrack;
  icp_eligible: boolean;
  hard_exclusion: boolean;
  rejection_reason: DecisionReasonCode | null;

  signal_states: SignalStates;
  primary_visitor_outcome: VisitorOutcome | null;

  scores: CommercialScores;
  score_components: Record<string, ScoreComponent>;

  certainty: Certainty;
  challenger_agreement: boolean | null;
  challenger_result: ChallengerResult | null;

  decision: DecisionOutcome;
  mode: DecisionMode;
  automatic_approval_eligible: boolean;
  decision_reasons: DecisionReasonCode[];
  review_flags: ReviewFlag[];

  priority: PriorityScore | null;
  versions: QualificationVersions;
  decided_at: string;

  /*
   * Why the deterministic scorer landed where it did. The gates already compute
   * these strings and used to drop them, which left a reviewer able to see THAT
   * a lead was excluded but not WHY. All optional so decisions stored before
   * these existed still validate — the UI shows "not recorded" for those.
   */
  track_reason?: string;
  hard_gate_reason?: string;
  core_gate?: {
    passes: boolean;
    unknown_signals: string[];
    absent_signals: string[];
    supporting_present: string[];
  };
  certainty_reasons?: string[];
  certainty_blockers?: string[];
};
