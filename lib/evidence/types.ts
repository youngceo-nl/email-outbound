/*
 * The evidence layer's public contract.
 *
 * The canonical definitions live in lib/qualification/types.ts so that the rule
 * engine and the collector cannot drift apart. This module re-exports the subset
 * an evidence producer needs, giving collectors a single import that never pulls
 * in decisioning types they have no business touching.
 *
 * The layering rule this file exists to enforce:
 *   collectors normalize evidence -> the model interprets it -> deterministic
 *   code decides. Nothing exported here decides whether a lead qualifies.
 */

export type {
  CaptureStatus,
  CtaHop,
  CtaHopSourceType,
  DestinationType,
  CommercialRelevance,
  EvidenceCitation,
  EvidenceSnapshot,
  EvidenceSourceType,
  ExternalDestination,
  ExtractedCta,
  InstagramEvidence,
  InstagramPostEvidence,
  OfferEvidence,
  ProofEvidence,
  AcquisitionStopReason,
  AcquisitionSufficiency,
  UnknownSurface,
  VisitorOutcome,
  YouTubeChannelEvidence,
  YouTubeVideoEvidence,
} from "@/lib/qualification/types";

export { INFORMATION_VISITOR_OUTCOMES, isUnknownCapture } from "@/lib/qualification/types";
export type { PageExtraction, DestinationClassification } from "./page-extract";
export type { AcquirePage, FetchedPage, PageFetchOutcome, PageFetchFailure } from "./http";
export type { RankedLink, ExternalCollectionResult, ExternalCollectorConfig } from "./external";
