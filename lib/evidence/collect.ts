/*
 * Evidence snapshot orchestration.
 *
 * Order is load-bearing: Instagram first (it names every other surface), then
 * external destinations, then YouTube, then a bounded second external pass for
 * commercial links discovered inside YouTube descriptions. The snapshot is
 * assembled and frozen before any model sees it, so a decision can be replayed
 * against exactly the bytes that produced it.
 */

import { randomUUID } from "node:crypto";
import type {
  AcquisitionStopReason,
  AcquisitionSufficiency,
  CtaHop,
  DataQuality,
  EvidenceSnapshot,
  ExternalDestination,
  InstagramEvidence,
  OfferEvidence,
  ProofEvidence,
  UnknownSurface,
  VisitorOutcome,
  VisualEvidence,
} from "@/lib/qualification/types";
import { computeActivityMetrics } from "./instagram";
import { collectDirectResponseCtas } from "./cta-signals";
import {
  collectExternalEvidence,
  createPageFetcher,
  DEFAULT_EXTERNAL_CONFIG,
  hopAction,
  outcomeResolved,
  type ExternalCollectionResult,
  type ExternalCollectorConfig,
  type PageFetcher,
} from "./external";
import { collectYouTubeEvidence, parseYouTubeRef, type YouTubeConfig } from "./youtube";
import { isYouTubeHost } from "./page-extract";
import { computeFunnelMaturitySignals } from "./funnel-maturity";
import { ACQUISITION_VERSION, FIXTURE_REVISION } from "./versions";

export type EvidenceCollectorDependencies = {
  fetchPage: PageFetcher;
  collectYouTube: typeof collectYouTubeEvidence;
  now: () => string;
  uuid: () => string;
};

export type CollectEvidenceOptions = {
  instagram: InstagramEvidence;
  dataQuality: DataQuality;
  leadId?: string | null;
  external?: Partial<ExternalCollectorConfig>;
  youtube?: Partial<YouTubeConfig>;
  dependencies?: Partial<EvidenceCollectorDependencies>;
  /*
   * The bio-link funnel as Steel already rendered it — see
   * lib/instagram/steel-acquisition.ts, AcquisitionResult.renderedDestinations.
   * When present and non-empty, it REPLACES the plain-HTTP external pass
   * rather than merging with it: the rendered pages already reflect
   * JavaScript-only content the HTTP fetcher can never see, so re-fetching
   * them over HTTP would only downgrade the evidence. The YouTube pass and
   * the YouTube-description second pass are unaffected — they run exactly as
   * before.
   */
  seedDestinations?: ExternalDestination[];
  /** Persisted profile/post images — see lib/instagram/profile-images.ts. */
  visualEvidence?: VisualEvidence;
};

export async function collectCommercialEvidence(
  opts: CollectEvidenceOptions,
): Promise<EvidenceSnapshot> {
  const externalConfig = { ...DEFAULT_EXTERNAL_CONFIG, ...opts.external };
  const deps: EvidenceCollectorDependencies = {
    fetchPage: opts.dependencies?.fetchPage ?? createPageFetcher(),
    collectYouTube: opts.dependencies?.collectYouTube ?? collectYouTubeEvidence,
    now: opts.dependencies?.now ?? (() => new Date().toISOString()),
    uuid: opts.dependencies?.uuid ?? randomUUID,
  };

  const instagram = opts.instagram;
  const capturedAt = deps.now();

  // ---- Pass 1: external destinations from the bio link ----
  const external =
    opts.seedDestinations && opts.seedDestinations.length > 0
      ? externalCollectionFromSeed(opts.seedDestinations)
      : await collectExternalEvidence({
          externalLink: instagram.external_link,
          fetcher: deps.fetchPage,
          config: externalConfig,
          now: deps.now,
        });

  // ---- YouTube references: the bio link, bio text, and anything the hub linked ----
  const youtubeRefs = new Set<string>(external.youtube_urls);
  const bioText = [instagram.bio, instagram.instagram_meta_description]
    .filter(Boolean)
    .join(" \n ");
  for (const match of bioText.matchAll(/https?:\/\/[^\s]+|(?:www\.)?youtube\.com\/[@\w/-]+/gi)) {
    if (parseYouTubeRef(match[0])) youtubeRefs.add(match[0]);
  }
  if (instagram.external_link && isYouTubeHost(instagram.external_link)) {
    youtubeRefs.add(instagram.external_link);
  }

  const youtubeIsPrimaryCta = Boolean(
    instagram.external_link && isYouTubeHost(instagram.external_link),
  );

  const youtube =
    youtubeRefs.size > 0
      ? await deps.collectYouTube({
          urls: [...youtubeRefs],
          isPrimaryCta: youtubeIsPrimaryCta,
          config: opts.youtube,
          now: deps.now,
        })
      : { channels: [], videos: [], outbound_urls: [] };

  // ---- Pass 2: commercial links found inside YouTube descriptions ----
  const alreadyInspected = new Set(
    external.destinations.map((destination) => destination.final_url ?? destination.source_url),
  );
  const followUpUrls = youtube.outbound_urls
    .filter((url) => !alreadyInspected.has(url))
    .slice(0, 2);

  const followUps: ExternalDestination[] = [];
  const followUpHops: CtaHop[] = [];
  let followUpHopsUsed = 0;

  for (const url of followUpUrls) {
    // The global hop budget is shared: YouTube follow-ups may not exceed it.
    if (external.hops_used + followUpHopsUsed + 1 > externalConfig.absoluteHopBudget) break;
    const result = await collectExternalEvidence({
      externalLink: url,
      fetcher: deps.fetchPage,
      config: { ...externalConfig, defaultHopBudget: 1, absoluteHopBudget: 1 },
      now: deps.now,
    });
    followUpHopsUsed += 1;
    for (const destination of result.destinations) {
      followUps.push({
        ...destination,
        destination_id: `youtube_destination_${followUps.length}`,
        selection_reason: `youtube description link | ${destination.selection_reason}`,
        hop: external.hops_used + followUpHopsUsed,
      });
    }
    const sourceVideo = youtube.videos.find((video) => video.outbound_urls.includes(url));
    followUpHops.push({
      hop: 0, // renumbered below
      source_type: sourceVideo ? "youtube_video" : "youtube_channel",
      source_id: sourceVideo?.video_id ?? youtube.channels[0]?.channel_id ?? "youtube",
      action: "visit_offer_page",
      destination_url: url,
      visitor_receives: result.destinations[0]?.visitor_receives[0] ?? null,
      evidence: "link in YouTube description",
    });
  }

  const destinations = [...external.destinations, ...followUps];
  const ctaChain = [...external.cta_hops, ...followUpHops].map((hop, index) => ({
    ...hop,
    hop: index,
  }));

  // ---- Derived state ----
  const unknownSurfaces = collectUnknownSurfaces(instagram, destinations, youtube);
  const primaryCta = derivePrimaryCta(instagram, destinations);
  const ultimateCta = deriveUltimateCta(ctaChain, destinations);
  const stopReason = mergeStopReason(external.stop_reason, followUps);
  const sufficiency = deriveSufficiency({
    instagram,
    destinations,
    youtubeIsPrimaryCta,
    youtubeChannels: youtube.channels,
    youtubeVideos: youtube.videos,
    stopReason,
  });

  return {
    snapshot_id: deps.uuid(),
    lead_id: opts.leadId ?? null,
    username: instagram.username,
    captured_at: capturedAt,

    instagram,
    external_destinations: destinations,
    external_capture_status: external.capture_status,
    youtube_channels: youtube.channels,
    youtube_videos: youtube.videos,

    cta_chain: ctaChain,
    primary_cta: primaryCta,
    ultimate_cta: ultimateCta,

    offer_inventory_seed: seedOfferInventory(destinations),
    proof_inventory_seed: seedProofInventory(instagram),
    direct_response_ctas: collectDirectResponseCtas([
      { text: instagram.bio, source: "bio:profile" },
      { text: instagram.instagram_meta_description, source: "instagram_metadata:profile" },
      ...instagram.pinned_posts.map((post) => ({
        text: post.caption,
        source: `pinned_post:${post.post_id}`,
      })),
      ...instagram.recent_posts.slice(0, 12).map((post) => ({
        text: post.caption,
        source: `recent_post:${post.post_id}`,
      })),
    ]),

    acquisition_stop_reason: stopReason,
    acquisition_sufficiency: sufficiency,
    unknown_surfaces: unknownSurfaces,
    hops_used: external.hops_used + followUpHopsUsed,

    activity: computeActivityMetrics(instagram, opts.dataQuality),
    versions: {
      acquisition_version: ACQUISITION_VERSION,
      fixture_revision: FIXTURE_REVISION,
    },

    visual_evidence: opts.visualEvidence,
    funnel_maturity_signals: computeFunnelMaturitySignals({
      instagram,
      destinations,
      snapshotHasTrackingSignals: destinations.some(
        (destination) => (destination.tracking_signals?.length ?? 0) > 0,
      ),
    }),
  };
}

/*
 * Adapts an already-rendered destination list (Steel's inspectFunnel) into
 * the same ExternalCollectionResult shape collectExternalEvidence produces,
 * so collectCommercialEvidence cannot tell the two apart downstream. Deriving
 * cta_hops, stop_reason, and capture_status here — rather than inside
 * collectExternalEvidence itself — avoids retrofitting seed-awareness into
 * that function's hop-budget and cycle-detection state machine, which tracks
 * a `visited` set no seed could safely pre-populate without either falsely
 * flagging a cycle on hop 0 or losing the ability to say why traversal
 * stopped.
 */
function externalCollectionFromSeed(seedDestinations: ExternalDestination[]): ExternalCollectionResult {
  const ctaHops: CtaHop[] = seedDestinations.map((destination, index) => ({
    hop: index,
    source_type: index === 0 ? "instagram_profile" : "external_page",
    source_id: index === 0 ? "profile" : seedDestinations[index - 1].destination_id,
    action: hopAction(destination.destination_type, destination.visible_label),
    destination_url: destination.final_url,
    visitor_receives: destination.visitor_receives[0] ?? null,
    evidence: destination.visible_label ?? destination.page_title ?? destination.selection_reason,
  }));

  const youtubeUrls = seedDestinations
    .filter((destination) => destination.destination_type === "youtube" && destination.final_url)
    .map((destination) => destination.final_url as string);

  const anyCaptured = seedDestinations.some((destination) => destination.capture_status === "captured");
  const anyFailed = seedDestinations.some((destination) => destination.capture_status !== "captured");

  return {
    destinations: seedDestinations,
    cta_hops: ctaHops,
    youtube_urls: youtubeUrls,
    stop_reason: outcomeResolved(seedDestinations)
      ? "ultimate_outcome_resolved"
      : seedDestinations.length === 0
        ? "no_commercial_action"
        : "complete",
    capture_status: anyCaptured ? "captured" : anyFailed ? "failed" : "not_attempted",
    hops_used: seedDestinations.reduce((max, destination) => Math.max(max, destination.hop), 0),
  };
}

// ---------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------

function collectUnknownSurfaces(
  instagram: InstagramEvidence,
  destinations: ExternalDestination[],
  youtube: { channels: Array<{ capture_status: string; url: string }>; videos: Array<{ capture_status: string; url: string }> },
): UnknownSurface[] {
  const out: UnknownSurface[] = [];

  if (instagram.recent_posts_capture_status !== "captured") {
    out.push({
      surface: "instagram_recent_posts",
      capture_status: instagram.recent_posts_capture_status,
      reason: "post sample not returned by provider",
    });
  }
  if (instagram.pinned_posts_capture_status !== "captured") {
    out.push({
      surface: "instagram_pinned_posts",
      capture_status: instagram.pinned_posts_capture_status,
      reason: "provider does not report pinned markers",
    });
  }
  if (instagram.external_link_capture_status !== "captured") {
    out.push({
      surface: "instagram_external_link",
      capture_status: instagram.external_link_capture_status,
      reason: "bio link not exposed by the acquisition method used",
    });
  }
  if (instagram.story_highlights_capture_status !== "captured") {
    out.push({
      surface: "story_highlights",
      capture_status: instagram.story_highlights_capture_status,
      reason: "highlight titles require an authenticated surface not attempted in v1",
    });
  }
  for (const destination of destinations) {
    if (destination.capture_status === "captured") continue;
    /*
     * A YouTube handoff is not an unknown surface — it was deliberately routed
     * to the YouTube collector, whose own capture states are reported below.
     * Listing it here would double-count one destination as two failures.
     */
    if (destination.destination_type === "youtube" && destination.error === "handed to youtube collector") {
      continue;
    }
    out.push({
      surface: `external:${destination.source_url}`,
      capture_status: destination.capture_status,
      reason: destination.error ?? "not captured",
    });
  }
  for (const channel of youtube.channels) {
    if (channel.capture_status !== "captured") {
      out.push({
        surface: `youtube_channel:${channel.url}`,
        capture_status: channel.capture_status as UnknownSurface["capture_status"],
        reason: "channel not captured",
      });
    }
  }
  for (const video of youtube.videos) {
    if (video.capture_status !== "captured") {
      out.push({
        surface: `youtube_video:${video.url}`,
        capture_status: video.capture_status as UnknownSurface["capture_status"],
        reason: "video description not captured",
      });
    }
  }
  return out;
}

function derivePrimaryCta(
  instagram: InstagramEvidence,
  destinations: ExternalDestination[],
): string | null {
  const bio = instagram.bio ?? "";
  // A DM or comment funnel is a primary CTA that never leaves Instagram, so it
  // outranks the bio link when both are present.
  const dm = bio.match(/\b(dm|message|comment|reply)\b[^.\n]{0,40}/i);
  if (dm) return dm[0].trim();

  const first = destinations.find((destination) => destination.hop === 0);
  if (!first) return null;
  if (first.destination_type === "youtube") return "watch_on_youtube";
  if (first.destination_type === "link_hub") return "open_link_hub";
  return first.cta_labels[0]?.label ?? `visit_${first.destination_type}`;
}

function deriveUltimateCta(
  ctaChain: CtaHop[],
  destinations: ExternalDestination[],
): string | null {
  // The ultimate action is the deepest destination that actually resolves an
  // outcome, not simply the last page the crawler happened to touch.
  const resolving = destinations
    .filter(
      (destination) =>
        destination.capture_status === "captured" &&
        ["application", "booking", "education", "community", "agency_service", "store"].includes(
          destination.destination_type,
        ),
    )
    .sort((a, b) => b.hop - a.hop)[0];

  if (resolving) {
    return resolving.cta_labels[0]?.label ?? `visit_${resolving.destination_type}`;
  }
  return ctaChain.length > 0 ? ctaChain[ctaChain.length - 1].action : null;
}

function mergeStopReason(
  base: AcquisitionStopReason,
  followUps: ExternalDestination[],
): AcquisitionStopReason {
  if (followUps.some((destination) => destination.capture_status === "captured")) {
    return "ultimate_outcome_resolved";
  }
  return base;
}

function deriveSufficiency(args: {
  instagram: InstagramEvidence;
  destinations: ExternalDestination[];
  youtubeIsPrimaryCta: boolean;
  youtubeChannels: Array<{ capture_status: string; description: string | null }>;
  youtubeVideos: Array<{ capture_status: string; description: string | null }>;
  stopReason: AcquisitionStopReason;
}): AcquisitionSufficiency {
  const { instagram, destinations, youtubeIsPrimaryCta, youtubeChannels, youtubeVideos, stopReason } =
    args;

  if (instagram.profile_capture_status !== "captured") return "insufficient";

  /*
   * Distinguish "we looked and there is no link" from "we could not see the
   * link". A captured-empty external surface is a complete answer; an
   * unavailable one leaves the whole funnel unknown and can never be sufficient.
   */
  if (!instagram.external_link) {
    if (instagram.external_link_capture_status !== "captured") return "insufficient";
    return instagram.bio ? "partial" : "insufficient";
  }

  const captured = destinations.filter((d) => d.capture_status === "captured");

  /*
   * A YouTube bio link is never fetched as HTML — it is handed to the YouTube
   * collector, which leaves a `not_attempted` placeholder behind. Judging
   * sufficiency on that placeholder would mark every YouTube-funnel profile
   * insufficient no matter how much of the channel we actually read, so the
   * YouTube evidence is what counts here.
   */
  if (youtubeIsPrimaryCta) {
    const descriptionRead = youtubeVideos.some(
      (video) => video.capture_status === "captured" && Boolean(video.description),
    );
    const channelRead = youtubeChannels.some(
      (channel) => channel.capture_status === "captured" && Boolean(channel.description),
    );
    if (!descriptionRead) return channelRead ? "partial" : "insufficient";

    // A description that led to a captured offer page resolves the outcome.
    const followedThrough = captured.some((d) =>
      ["application", "booking", "education", "community", "agency_service", "lead_magnet"].includes(
        d.destination_type,
      ),
    );
    return followedThrough ? "sufficient" : "partial";
  }

  if (captured.length === 0) return "insufficient";

  // A hub that was read but whose children were never reached leaves the real
  // offer unknown, which is the exact case the spec refuses to call sufficient.
  const onlyHub =
    captured.length === 1 && captured[0].destination_type === "link_hub";
  if (onlyHub) return "partial";

  const resolvedOutcome = captured.some((d) =>
    ["application", "booking", "education", "community", "agency_service", "store", "lead_magnet"].includes(
      d.destination_type,
    ),
  );
  if (!resolvedOutcome) return "partial";

  if (stopReason === "max_hops_reached" || stopReason === "budget_exhausted") return "partial";

  return "sufficient";
}

// ---------------------------------------------------------------------------
// Deterministic inventory seeds
//
// These are hints for the extractor, not conclusions. The AI re-derives the
// real inventory with citations; a wrong seed cannot by itself qualify a lead.
// ---------------------------------------------------------------------------

const DESTINATION_OFFER_TYPE: Record<string, OfferEvidence["type"]> = {
  education: "information_product",
  community: "community",
  booking: "coaching",
  application: "coaching",
  agency_service: "done_for_you_service",
  store: "commerce_product",
  lead_magnet: "information_product",
};

function seedOfferInventory(destinations: ExternalDestination[]): OfferEvidence[] {
  const out: OfferEvidence[] = [];
  for (const destination of destinations) {
    if (destination.capture_status !== "captured") continue;
    const type = DESTINATION_OFFER_TYPE[destination.destination_type];
    if (!type) continue;

    out.push({
      offer_id: `seed_${destination.destination_id}`,
      name: destination.page_title,
      type,
      prominence: destination.hop === 0 ? "primary" : "secondary",
      audience: null,
      delivery: destination.meta_description,
      visitor_receives: destination.visitor_receives as VisitorOutcome[],
      customer_implementation_role: "unknown",
      price: destination.prices[0] ?? null,
      cta: destination.cta_labels[0]?.label ?? null,
      // Deterministic seed, confirmed or overridden by the extractor — see
      // lib/evidence/page-extract.ts for what fires paid_offer_signals and
      // offer_status_signals. "unknown" rather than "free"/"active": absence
      // of a signal is not evidence of the opposite.
      is_paid: (destination.paid_offer_signals?.length ?? 0) > 0 ? "paid" : "unknown",
      active_status: (destination.offer_status_signals?.length ?? 0) > 0 ? "inactive" : "unknown",
      evidence: [
        {
          source_type: "external_page",
          source_id: destination.destination_id,
          url: destination.final_url,
          field: "page_title",
          phrase: destination.page_title ?? destination.destination_type,
        },
      ],
    });
  }
  return out;
}

/*
 * Quantified claims only. "Helped people" without a number is authority
 * evidence, not proof, and the spec is explicit that follower and view counts
 * must not be counted as client results.
 */
const PROOF_PATTERNS: Array<{ type: ProofEvidence["result_type"]; pattern: RegExp }> = [
  { type: "revenue", pattern: /[$€£]\s?\d[\d,.]*\s?(k|m|million|billion)?\b(?![^\s]*\/)/gi },
  {
    type: "people_helped",
    pattern: /\b(helped|coached|trained|taught|mentored|served)\s+(?:over\s+|\+)?([\d,]+)\+?\s+([a-z]+)/gi,
  },
  { type: "clients_served", pattern: /\b([\d,]+)\+?\s+(clients|customers)\b/gi },
  { type: "students_taught", pattern: /\b([\d,]+)\+?\s+(students|members)\b/gi },
];

function seedProofInventory(instagram: InstagramEvidence): ProofEvidence[] {
  const sources: Array<{ text: string; field: string; sourceType: "bio" | "recent_post" | "pinned_post"; id: string }> = [];
  if (instagram.bio) sources.push({ text: instagram.bio, field: "bio", sourceType: "bio", id: "profile" });
  for (const post of instagram.pinned_posts) {
    if (post.caption) sources.push({ text: post.caption, field: "caption", sourceType: "pinned_post", id: post.post_id });
  }
  for (const post of instagram.recent_posts.slice(0, 8)) {
    if (post.caption) sources.push({ text: post.caption, field: "caption", sourceType: "recent_post", id: post.post_id });
  }

  const out: ProofEvidence[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    for (const { type, pattern } of PROOF_PATTERNS) {
      for (const match of source.text.matchAll(new RegExp(pattern))) {
        const claim = match[0].trim();
        if (seen.has(claim.toLowerCase())) continue;
        seen.add(claim.toLowerCase());
        out.push({
          proof_id: `seed_proof_${out.length}`,
          claim,
          // Deterministic code cannot know who the result belongs to. Guessing
          // here is exactly how agency-client revenue ends up crediting a
          // coaching offer, so the seed stays honest and defers to the AI.
          beneficiary: "unknown",
          result_type: type,
          value: null,
          currency: null,
          attributed_offer_id: null,
          producing_model: null,
          self_reported: true,
          evidence: [
            {
              source_type: source.sourceType,
              source_id: source.id,
              url: null,
              field: source.field,
              phrase: claim,
            },
          ],
        });
        if (out.length >= 12) return out;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Citation resolution
// ---------------------------------------------------------------------------

/** Every `source_type:source_id` a model is allowed to cite for this snapshot. */
export function snapshotSourceIds(snapshot: EvidenceSnapshot): Set<string> {
  const ids = new Set<string>();
  ids.add("display_name:profile");
  ids.add("bio:profile");
  ids.add("instagram_metadata:profile");

  for (const title of snapshot.instagram.story_highlight_titles) {
    ids.add(`highlight:${title}`);
  }
  for (const post of snapshot.instagram.recent_posts) ids.add(`recent_post:${post.post_id}`);
  for (const post of snapshot.instagram.pinned_posts) ids.add(`pinned_post:${post.post_id}`);

  for (const destination of snapshot.external_destinations) {
    ids.add(`external_page:${destination.destination_id}`);
    ids.add(`link_hub:${destination.destination_id}`);
  }
  for (const channel of snapshot.youtube_channels) ids.add(`youtube_channel:${channel.channel_id}`);
  for (const video of snapshot.youtube_videos) ids.add(`youtube_video:${video.video_id}`);

  // Only images actually persisted are citable — an image we could not
  // download must not be citable as if it were inspected.
  for (const image of snapshot.visual_evidence?.images ?? []) {
    if (image.capture_status === "captured") {
      ids.add(`${image.source_type}:${image.source_id}`);
    }
  }

  return ids;
}
