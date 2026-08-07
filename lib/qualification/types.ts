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
  | "recent_post"
  | "profile_image"
  | "post_image";

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
  /*
   * Visual evidence for Gate 2 ("the individual appears prominently in the
   * content"). Optional so posts normalized before this field existed still
   * validate — an absent thumbnail means "not captured", never "no image".
   */
  thumbnail_url?: string | null;
  shortcode?: string | null;
  url?: string | null;
  is_reel?: boolean;
};

export type InstagramProfileExtractionMethod =
  | "visible_dom"
  | "metadata_fallback"
  | "provider"
  | "combined";

/*
 * Which concrete acquisition path served a profile. Distinct from
 * InstagramProfileExtractionMethod, which describes the SHAPE of the parse:
 * Steel and Apify can both report "provider", so the extraction method alone
 * cannot tell them apart when a run misbehaves.
 */
export type AcquisitionSource = "steel" | "apify";

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
  /*
   * Full highlight objects (title + semantic group + cover image), additive
   * to `story_highlight_titles` above rather than replacing it — existing
   * consumers of the titles-only array keep working unchanged. Optional so
   * snapshots captured before this field existed still validate.
   */
  story_highlights?: StoryHighlightEvidence[];

  /*
   * Gate 2 ("the individual appears prominently in the content") is
   * unanswerable from text alone. The URL is a signed, short-lived Instagram
   * CDN link — see StoredImage for the replayable copy. Optional so
   * snapshots captured before this field existed still validate.
   */
  profile_pic_url?: string | null;
  profile_pic_capture_status?: CaptureStatus;
};

export type HighlightGroupLabel = "Proof" | "Offer" | "Funnel" | "Authority" | "Other";

export type StoryHighlightEvidence = {
  highlight_id: string;
  title: string;
  group: HighlightGroupLabel;
  cover_url: string | null;
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
  /*
   * "rendered" means the page was opened in a real browser (the Steel session
   * already open for Instagram acquisition), so JS-only checkout and pricing
   * content is visible. "free_fetch" never executes JavaScript — see
   * lib/evidence/http.ts. Distinguishing the two matters because paid-vs-free
   * evidence is frequently JS-rendered (Kajabi, Stripe, Circle).
   */
  capture_method: "free_fetch" | "rendered" | "none";
  captured_at: string | null;
  error: string | null;
  /*
   * The raw HTTP status, when known. A 404/410 is a distinct fact from a fetch
   * failure — "the offer page is gone" versus "we could not reach it" — and the
   * spec needs that distinction for "coaches whose paid offer is no longer
   * active". Optional so destinations captured before this field existed still
   * validate.
   */
  http_status?: number | null;
  /** Checkout/enrolment/price-commitment phrases — see lib/evidence/page-extract.ts. */
  paid_offer_signals?: string[];
  /** "doors closed", "waitlist", a past cohort date, etc. */
  offer_status_signals?: string[];
  /** Meta/TikTok/Google Ads pixels and GTM — the spec's retargeting signal. */
  tracking_signals?: string[];
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

export type PaidStatus = "paid" | "free" | "unknown";
export type OfferActiveStatus = "active" | "inactive" | "unknown";

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
  /*
   * The spec repeatedly distinguishes a course existing from a *paid* course
   * existing ("do not qualify based solely on a free course"). Seeded from the
   * deterministic paid_offer_signals on the destination the offer was found on,
   * then confirmed by the extractor. Optional so offers extracted before this
   * field existed still validate.
   */
  is_paid?: PaidStatus;
  /** "coaches whose paid offer is no longer active" — seeded from offer_status_signals. */
  active_status?: OfferActiveStatus;
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

  /*
   * Facts about the stored profile/post images (Gate 2's visual evidence).
   * Optional so snapshots captured before this field existed still validate —
   * they simply carry no visual evidence, which routes Gate 2 to uncertain
   * rather than a wrong answer.
   */
  visual_evidence?: VisualEvidence;
  /*
   * The spec's Dimension 6 (Funnel and Business Maturity) inventory. Assembled
   * deterministically from data already in this snapshot — see
   * lib/evidence/funnel-maturity.ts. Optional for the same replay reason.
   */
  funnel_maturity_signals?: FunnelMaturitySignal[];
};

/** A profile or post image persisted to storage so it survives CDN URL expiry. */
export type StoredImage = {
  source_id: string;
  source_type: "profile_image" | "post_image";
  /** The original, signed, short-lived Instagram CDN URL — kept for provenance only. */
  original_url: string;
  /** Path inside Supabase Storage; null when the download/upload failed. */
  storage_path: string | null;
  capture_status: CaptureStatus;
};

export type VisualEvidence = {
  images: StoredImage[];
  capture_status: CaptureStatus;
};

export type FunnelMaturitySignalKind =
  | "name_field_positioning"
  | "bio_promise"
  | "application_funnel"
  | "webinar_funnel"
  | "booking_funnel"
  | "results_highlight"
  | "start_here_highlight"
  | "offer_highlight"
  | "pinned_proof_or_intro"
  | "lead_magnet"
  | "retargeting"
  | "multiple_ctas"
  | "branded_methodology";

export type FunnelMaturitySignal = {
  kind: FunnelMaturitySignalKind;
  present: boolean;
  evidence: EvidenceCitation[];
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
  /*
   * Gate 3's independent fact: does the individual operate as a coach,
   * consultant, mentor, strategist, advisor, educator, or transformation
   * expert — including the spec's semantic pass signals ("I help agency
   * owners scale past €100k/month"), not just literal titles. Optional so
   * extractions from older prompt versions still validate.
   */
  coach_or_consultant?: SignalBlock;
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
  | "profile_unavailable"
  // Revised Instagram ICP Qualification Logic — the four hard gates
  // (lib/qualification/icp-gates.ts). Distinct from the pre-existing codes
  // above, which belong to the older business-model/core gate.
  | "follower_below_minimum"
  | "follower_count_unknown"
  | "personal_brand_gate_failed"
  | "personal_brand_gate_uncertain"
  | "coach_or_consultant_gate_failed"
  | "coach_or_consultant_gate_uncertain"
  | "relevant_offer_gate_failed"
  | "relevant_offer_gate_uncertain"
  | "icp_score_below_threshold"
  | "icp_score_review_band"
  | "icp_score_high_priority";

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
  /** Optional so decisions stored before the vision pass existed still validate. */
  vision_prompt_version?: string;
};

// ---------------------------------------------------------------------------
// Revised Instagram ICP Qualification Logic — gates, score, tier
// ---------------------------------------------------------------------------

export type GateStatus = "pass" | "fail" | "uncertain";

export type GateResult = {
  status: GateStatus;
  evidence: EvidenceCitation[];
  reason: string;
};

export type IcpGateResults = {
  follower_gate: "pass" | "fail" | "unknown";
  personal_brand: GateResult;
  coach_or_consultant: GateResult;
  relevant_offer: GateResult;
};

export type IcpScores = {
  audience_specificity: number;
  transformation_clarity: number;
  offer_clarity: number;
  conversion_path: number;
  proof: number;
  funnel_maturity: number;
  /** 0-12, the sum of the six dimensions above. */
  total_icp_score: number;
};

export type IcpQualificationTier =
  | "QUALIFIED_HIGH_PRIORITY"
  | "QUALIFIED"
  | "MANUAL_REVIEW"
  | "REJECTED";

export type CommercialDecision = {
  scorecard_version: string;
  evidence_snapshot_id: string;
  extraction_id: string | null;

  /*
   * The PDF's literal four-value output. Optional so decisions stored before
   * this field existed still validate; present on everything decided from
   * this scorecard version onward. See lib/qualification/icp-gates.ts and
   * icp-score.ts for how it's derived, and decide.ts for how it maps onto
   * `decision`/`mode` below (kept as the DB's constrained, filterable pair).
   */
  qualification?: IcpQualificationTier;
  icp_gates?: IcpGateResults;
  icp_scores?: IcpScores;
  /** Per-dimension reasoning and citations behind icp_scores — see icp-score.ts's ScoreResult.components. */
  icp_score_components?: Record<string, ScoreComponent>;

  track: CommercialTrack;
  icp_eligible: boolean;
  hard_exclusion: boolean;
  rejection_reason: DecisionReasonCode | null;

  signal_states: SignalStates;
  primary_visitor_outcome: VisitorOutcome | null;

  /*
   * The retired 10-point scorer's output — last used under SCORECARD_VERSION
   * "personal-brand-score-v1", superseded by "icp-gates-score-v1". See
   * icp_scores above for what replaced it. Optional so old stored decisions
   * still validate; undefined on every decision made from this version onward.
   */
  scores?: CommercialScores;
  score_components?: Record<string, ScoreComponent>;

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
