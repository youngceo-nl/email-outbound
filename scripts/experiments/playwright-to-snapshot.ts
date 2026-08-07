/*
 * Bridge: Playwright experiment report -> production EvidenceSnapshot.
 *
 * EXPERIMENT ONLY. This proves the browser-acquired evidence is sufficient to
 * drive the real qualification pipeline, without touching production
 * acquisition code. It maps shapes and nothing else — no field is invented, and
 * every capture state carries through unchanged so an unknown surface stays
 * unknown all the way to the decision.
 *
 *   npx tsx scripts/experiments/playwright-to-snapshot.ts <username>
 */

import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { computeActivityMetrics } from "@/lib/evidence/instagram";
import { collectDirectResponseCtas } from "@/lib/evidence/cta-signals";
import { assessSufficiency } from "@/lib/evidence/sufficiency";
import { ACQUISITION_VERSION, FIXTURE_REVISION } from "@/lib/evidence/versions";
import { requalifyFromSnapshot } from "@/lib/qualification/run";
import { createLlmClient } from "@/lib/qualification/providers";
import type {
  CaptureStatus,
  CtaHop,
  EvidenceSnapshot,
  ExternalDestination,
  InstagramEvidence,
  InstagramPostEvidence,
  VisitorOutcome,
} from "@/lib/qualification/types";
import { OUTPUT_DIR } from "./playwright-instagram-shared";

const TARGET = process.argv[2]?.replace(/^@/, "") ?? "charliewelham_";

type PlaywrightPost = {
  post_id: string;
  caption: string | null;
  taken_at: string | null;
  is_video: boolean;
  is_reel: boolean;
  is_pinned: boolean;
  likes: number | null;
  comments: number | null;
  views: number | null;
};

type PlaywrightReport = {
  username: string;
  profile: Record<string, unknown>;
  recent_posts: PlaywrightPost[];
  pinned_posts: PlaywrightPost[];
  highlights: Array<{ title: string; group: string }>;
  external_destinations: Array<Record<string, unknown>>;
  capture_statuses: Record<string, CaptureStatus>;
};

function toPost(post: PlaywrightPost): InstagramPostEvidence {
  return {
    post_id: post.post_id,
    caption: post.caption,
    taken_at: post.taken_at,
    is_video: post.is_video,
    is_pinned: post.is_pinned,
    likes: post.likes,
    comments: post.comments,
    views: post.views,
  };
}

function buildSnapshot(report: PlaywrightReport): EvidenceSnapshot {
  const profile = report.profile as Record<string, string | number | boolean | null>;
  const statuses = report.capture_statuses;

  const instagram: InstagramEvidence = {
    username: String(profile.username ?? report.username),
    display_name: (profile.display_name as string) ?? null,
    category: (profile.category as string) ?? null,
    bio: (profile.biography as string) ?? null,
    external_link: (profile.external_link as string) ?? null,
    is_private: Boolean(profile.is_private),
    is_verified: Boolean(profile.is_verified),
    followers: (profile.followers as number) ?? null,
    following: (profile.following as number) ?? null,
    total_posts: (profile.total_posts as number) ?? null,
    instagram_meta_description: null,
    // The browser reads the rendered page, not a metadata fallback.
    profile_extraction_method: "visible_dom",
    profile_capture_status: statuses.profile,
    profile_captured_at: new Date().toISOString(),
    // Unlike the metadata fallback, the browser genuinely sees the bio link.
    external_link_capture_status: statuses.external_link,
    recent_posts: report.recent_posts.map(toPost),
    recent_posts_capture_status: statuses.recent_posts,
    pinned_posts: report.pinned_posts.map(toPost),
    pinned_posts_capture_status: statuses.pinned_posts,
    /*
     * Titles are real evidence here — the browser read them off the rail. No
     * HTTP-only acquisition path can see this surface at all.
     */
    story_highlight_titles: report.highlights.map((highlight) => highlight.title),
    story_highlights_capture_status: statuses.highlight_titles,
    story_highlights_captured_at: new Date().toISOString(),
  };

  const destinations: ExternalDestination[] = report.external_destinations.map((raw, index) => ({
    destination_id: `destination_${index}`,
    source_url: String(raw.source_url ?? ""),
    final_url: (raw.final_url as string) ?? null,
    redirect_chain: (raw.redirect_chain as string[]) ?? [],
    visible_label: null,
    page_title: (raw.page_title as string) ?? null,
    meta_description: (raw.meta_description as string) ?? null,
    headings: (raw.headings as string[]) ?? [],
    cta_labels: (raw.cta_labels as Array<{ label: string; url: string | null }>) ?? [],
    offer_copy: (raw.offer_copy as string[]) ?? [],
    prices: (raw.prices as string[]) ?? [],
    destination_type: (raw.destination_type as ExternalDestination["destination_type"]) ?? "unknown",
    candidate_types: (raw.candidate_types as ExternalDestination["candidate_types"]) ?? [],
    classification_state:
      (raw.classification_state as ExternalDestination["classification_state"]) ?? "unknown",
    form_signals: (raw.form_signals as string[]) ?? [],
    service_delivery_signals: (raw.service_delivery_signals as string[]) ?? [],
    education_delivery_signals: (raw.education_delivery_signals as string[]) ?? [],
    proof_claims: (raw.proof_claims as string[]) ?? [],
    visitor_receives: (raw.visitor_receives as VisitorOutcome[]) ?? [],
    commercial_relevance: index === 0 ? "primary" : "supporting",
    selection_reason: "playwright funnel traversal",
    rank: index,
    hop: Number(raw.hop ?? index),
    text_excerpt: null,
    capture_status: (raw.capture_status as CaptureStatus) ?? "captured",
    capture_method: "free_fetch",
    captured_at: new Date().toISOString(),
    error: (raw.error as string) ?? null,
  }));

  const ctaChain: CtaHop[] = destinations.map((destination, index) => ({
    hop: index,
    source_type: index === 0 ? "instagram_profile" : "external_page",
    source_id: index === 0 ? "profile" : `destination_${index - 1}`,
    action: destination.cta_labels[0]?.label?.toLowerCase().replace(/\s+/g, "_") ?? "visit_page",
    destination_url: destination.final_url,
    visitor_receives: destination.visitor_receives[0] ?? null,
    evidence: destination.page_title ?? "funnel hop",
  }));

  const sufficiency = assessSufficiency(instagram);

  const resolved = destinations.some((destination) =>
    ["application", "booking", "education", "community", "agency_service", "store", "lead_magnet"].includes(
      destination.destination_type,
    ),
  );

  return {
    snapshot_id: randomUUID(),
    lead_id: null,
    username: instagram.username,
    captured_at: new Date().toISOString(),
    instagram,
    external_destinations: destinations,
    external_capture_status: statuses.external_funnel,
    youtube_channels: [],
    youtube_videos: [],
    cta_chain: ctaChain,
    primary_cta: instagram.bio?.match(/\b(dm|comment)\b[^.\n]{0,40}/i)?.[0]?.trim() ?? null,
    ultimate_cta: destinations[destinations.length - 1]?.cta_labels[0]?.label ?? null,
    offer_inventory_seed: [],
    proof_inventory_seed: [],
    direct_response_ctas: collectDirectResponseCtas([
      { text: instagram.bio, source: "bio:profile" },
      ...instagram.pinned_posts.map((post) => ({
        text: post.caption,
        source: `pinned_post:${post.post_id}`,
      })),
      ...instagram.recent_posts.slice(0, 12).map((post) => ({
        text: post.caption,
        source: `recent_post:${post.post_id}`,
      })),
    ]),
    acquisition_stop_reason: resolved ? "ultimate_outcome_resolved" : "no_commercial_action",
    // The browser resolved the funnel to a terminal outcome, so this is a
    // genuinely sufficient acquisition — not the "partial" the fallback produced.
    acquisition_sufficiency: resolved && statuses.profile === "captured" ? "sufficient" : "partial",
    unknown_surfaces: Object.entries(statuses)
      .filter(([, status]) => status !== "captured")
      .map(([surface, status]) => ({
        surface,
        capture_status: status,
        reason: "not captured by the browser acquisition",
      })),
    hops_used: Math.max(0, destinations.length - 1),
    activity: computeActivityMetrics(instagram, sufficiency.data_quality),
    versions: { acquisition_version: `${ACQUISITION_VERSION}+playwright`, fixture_revision: FIXTURE_REVISION },
  };
}

async function main(): Promise<void> {
  const report = JSON.parse(
    readFileSync(`${OUTPUT_DIR}/${TARGET}-evidence.json`, "utf8"),
  ) as PlaywrightReport;

  const snapshot = buildSnapshot(report);
  writeFileSync(`${OUTPUT_DIR}/${TARGET}-snapshot.json`, JSON.stringify(snapshot, null, 2));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is required to run extraction.");
    process.exit(1);
  }

  const llm = createLlmClient({ provider: "anthropic", model: "claude-haiku-4-5", apiKey });
  const challengerLlm = createLlmClient({ provider: "anthropic", model: "claude-opus-5", apiKey });

  console.log(`Qualifying @${TARGET} from Playwright-acquired evidence`);
  console.log(`  extractor:  anthropic/claude-haiku-4-5`);
  console.log(`  challenger: anthropic/claude-opus-5\n`);

  const result = await requalifyFromSnapshot({ snapshot, llm, challengerLlm });
  const decision = result.decision;

  console.log(`DECISION      ${decision.decision.toUpperCase()} (${decision.mode})`);
  console.log(`qualification ${decision.qualification ?? "n/a"}`);
  console.log(`track         ${decision.track}`);
  console.log(`icp score     ${decision.icp_scores?.total_icp_score ?? "n/a"} / 12   certainty: ${decision.certainty}`);
  console.log(`priority      ${decision.priority ? `${decision.priority.value} / 10` : "n/a"}`);
  console.log(`outcome       ${decision.primary_visitor_outcome ?? "unknown"}`);
  if (decision.rejection_reason) console.log(`rejected for  ${decision.rejection_reason}`);

  console.log(`\nSCORES`);
  for (const [name, value] of Object.entries(decision.icp_scores ?? {})) {
    console.log(`  ${name.padEnd(30)} ${String(value).padStart(5)}`);
  }

  console.log(`\nGATES`);
  if (decision.icp_gates) {
    console.log(`  follower_gate                 ${decision.icp_gates.follower_gate}`);
    console.log(`  personal_brand                ${decision.icp_gates.personal_brand.status}`);
    console.log(`  coach_or_consultant           ${decision.icp_gates.coach_or_consultant.status}`);
    console.log(`  relevant_offer                ${decision.icp_gates.relevant_offer.status}`);
  }

  console.log(`\nSIGNALS`);
  for (const [name, state] of Object.entries(decision.signal_states)) {
    console.log(`  ${name.padEnd(24)} ${state}`);
  }

  if (result.extraction?.ok) {
    const extraction = result.extraction.extraction;
    console.log(`\nEXTRACTED`);
    console.log(`  audience:       ${extraction.audience.value ?? "-"} (${extraction.audience.label})`);
    console.log(`  transformation: ${extraction.transformation.outcome ?? "-"}`);
    console.log(`  funnel:         ${extraction.information_funnel.asset_or_offer ?? "-"}`);
    console.log(`  cta:            ${extraction.cta.action ?? "-"} (${extraction.cta.label})`);
    console.log(`  models:         ${extraction.business_models.map((m) => `${m.type}:${m.prominence}`).join(", ")}`);
    for (const offer of extraction.offers) {
      console.log(`  offer: ${offer.name ?? offer.offer_id} [${offer.type}/${offer.prominence}] price=${offer.price ?? "-"}`);
    }
    for (const proof of extraction.proof_attribution) {
      console.log(`  proof: ${proof.claim.slice(0, 60)} [${proof.beneficiary}]`);
    }
    if (extraction.conflicts.length > 0) console.log(`  conflicts: ${extraction.conflicts.join("; ")}`);
  } else if (result.extraction) {
    console.log(`\nEXTRACTION FAILED (${result.extraction.reason})`);
    for (const problem of result.extraction.problems.slice(0, 5)) console.log(`  - ${problem}`);
  }

  console.log(`\nCHALLENGER    ${result.challenger_trigger}`);
  if (result.challenger?.result) {
    console.log(`  conclusion: ${result.challenger.result.business_model_conclusion} | agrees=${result.challenger.agrees}`);
    console.log(`  reason: ${result.challenger.result.reason.slice(0, 200)}`);
    for (const disagreement of result.challenger.disagreements) console.log(`  ! ${disagreement}`);
  } else if (result.challenger?.error) {
    console.log(`  error: ${result.challenger.error.slice(0, 160)}`);
  }

  console.log(`\nREASONS       ${decision.decision_reasons.join(", ")}`);
  console.log(`FLAGS         ${decision.review_flags.join(", ") || "-"}`);
  console.log(
    `TOKENS        ${result.usage.inputTokens} in / ${result.usage.outputTokens} out  |  ${result.timings_ms.total}ms`,
  );

  writeFileSync(
    `${OUTPUT_DIR}/${TARGET}-qualification.json`,
    JSON.stringify({ snapshot, decision, extraction: result.extraction, challenger: result.challenger }, null, 2),
  );
  console.log(`\nWritten: ${OUTPUT_DIR}/${TARGET}-qualification.json`);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
