/*
 * Deterministic inventory for the spec's Dimension 6 (Funnel and Business
 * Maturity) — see docs referencing "Revised Instagram ICP Qualification
 * Logic". Every signal here is assembled from data already present in the
 * snapshot; nothing is invented and nothing is scored. This is a seed for
 * the extractor and the deterministic scorer, exactly like
 * offer_inventory_seed and proof_inventory_seed above it — it can be wrong or
 * incomplete, but it can never be uncited.
 */

import type {
  EvidenceCitation,
  ExternalDestination,
  FunnelMaturitySignal,
  FunnelMaturitySignalKind,
  InstagramEvidence,
} from "@/lib/qualification/types";

const NAME_POSITIONING_PATTERN =
  /\b(coach|consultant|mentor|strategist|advisor|founder|educator)\b/i;
const BIO_PROMISE_PATTERN =
  /\b(i help|we help|helping|teaching|showing you how)\b/i;
const WEBINAR_PATTERN = /\b(webinar|masterclass|free training)\b/i;
const BRANDED_METHOD_PATTERN =
  /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3}\s+(Method|Framework|System|Formula|Blueprint|Process))\b/;

function cite(args: {
  source_type: EvidenceCitation["source_type"];
  source_id: string;
  url?: string | null;
  field: string;
  phrase: string;
}): EvidenceCitation {
  return {
    source_type: args.source_type,
    source_id: args.source_id,
    url: args.url ?? null,
    field: args.field,
    phrase: args.phrase.slice(0, 300),
  };
}

function destinationText(destination: ExternalDestination): string {
  return [destination.page_title, destination.meta_description, ...destination.headings, ...destination.offer_copy]
    .filter(Boolean)
    .join(" \n ");
}

export function computeFunnelMaturitySignals(opts: {
  instagram: InstagramEvidence;
  destinations: ExternalDestination[];
  snapshotHasTrackingSignals: boolean;
}): FunnelMaturitySignal[] {
  const { instagram, destinations } = opts;
  const signal = (kind: FunnelMaturitySignalKind, present: boolean, evidence: EvidenceCitation[]): FunnelMaturitySignal => ({
    kind,
    present,
    evidence: present ? evidence : [],
  });

  const out: FunnelMaturitySignal[] = [];

  // ---- name_field_positioning ----
  const nameMatch = instagram.display_name && NAME_POSITIONING_PATTERN.test(instagram.display_name);
  out.push(
    signal("name_field_positioning", Boolean(nameMatch), [
      cite({ source_type: "display_name", source_id: "profile", field: "display_name", phrase: instagram.display_name ?? "" }),
    ]),
  );

  // ---- bio_promise ----
  const bioMatch = instagram.bio && BIO_PROMISE_PATTERN.test(instagram.bio);
  out.push(
    signal("bio_promise", Boolean(bioMatch), [
      cite({ source_type: "bio", source_id: "profile", field: "bio", phrase: instagram.bio ?? "" }),
    ]),
  );

  // ---- application / booking funnels ----
  const applicationDest = destinations.find((d) => d.destination_type === "application" && d.capture_status === "captured");
  out.push(
    signal("application_funnel", Boolean(applicationDest), applicationDest ? [
      cite({ source_type: "external_page", source_id: applicationDest.destination_id, url: applicationDest.final_url, field: "destination_type", phrase: "application" }),
    ] : []),
  );

  const bookingDest = destinations.find((d) => d.destination_type === "booking" && d.capture_status === "captured");
  out.push(
    signal("booking_funnel", Boolean(bookingDest), bookingDest ? [
      cite({ source_type: "external_page", source_id: bookingDest.destination_id, url: bookingDest.final_url, field: "destination_type", phrase: "booking" }),
    ] : []),
  );

  // ---- webinar_funnel ----
  const webinarDest = destinations.find(
    (d) => d.capture_status === "captured" && WEBINAR_PATTERN.test(destinationText(d)),
  );
  out.push(
    signal("webinar_funnel", Boolean(webinarDest), webinarDest ? [
      cite({ source_type: "external_page", source_id: webinarDest.destination_id, url: webinarDest.final_url, field: "page_content", phrase: destinationText(webinarDest).match(WEBINAR_PATTERN)?.[0] ?? "webinar" }),
    ] : []),
  );

  // ---- lead_magnet ----
  const leadMagnetDest = destinations.find((d) => d.destination_type === "lead_magnet" && d.capture_status === "captured");
  out.push(
    signal("lead_magnet", Boolean(leadMagnetDest), leadMagnetDest ? [
      cite({ source_type: "external_page", source_id: leadMagnetDest.destination_id, url: leadMagnetDest.final_url, field: "destination_type", phrase: "lead_magnet" }),
    ] : []),
  );

  // ---- Highlights: results / start-here / offer ----
  const highlights = instagram.story_highlights ?? [];
  const findHighlight = (predicate: (title: string, group: string) => boolean) =>
    highlights.find((h) => predicate(h.title.toLowerCase(), h.group));

  const resultsHighlight = findHighlight((title, group) => group === "Proof" || /result/i.test(title));
  out.push(
    signal("results_highlight", Boolean(resultsHighlight), resultsHighlight ? [
      cite({ source_type: "highlight", source_id: resultsHighlight.highlight_id, field: "title", phrase: resultsHighlight.title }),
    ] : []),
  );

  const startHereHighlight = findHighlight((title) => /start here/i.test(title));
  out.push(
    signal("start_here_highlight", Boolean(startHereHighlight), startHereHighlight ? [
      cite({ source_type: "highlight", source_id: startHereHighlight.highlight_id, field: "title", phrase: startHereHighlight.title }),
    ] : []),
  );

  const offerHighlight = findHighlight((_title, group) => group === "Offer");
  out.push(
    signal("offer_highlight", Boolean(offerHighlight), offerHighlight ? [
      cite({ source_type: "highlight", source_id: offerHighlight.highlight_id, field: "title", phrase: offerHighlight.title }),
    ] : []),
  );

  // ---- pinned_proof_or_intro ----
  const pinned = instagram.pinned_posts[0];
  out.push(
    signal("pinned_proof_or_intro", instagram.pinned_posts.length > 0, pinned ? [
      cite({ source_type: "pinned_post", source_id: pinned.post_id, field: "caption", phrase: pinned.caption ?? "(pinned post)" }),
    ] : []),
  );

  // ---- retargeting ----
  const trackingDest = destinations.find((d) => (d.tracking_signals?.length ?? 0) > 0);
  out.push(
    signal("retargeting", opts.snapshotHasTrackingSignals, trackingDest ? [
      cite({ source_type: "external_page", source_id: trackingDest.destination_id, url: trackingDest.final_url, field: "tracking_signals", phrase: (trackingDest.tracking_signals ?? []).join(", ") }),
    ] : []),
  );

  // ---- multiple_ctas ----
  const ctaCount = destinations.reduce((total, d) => total + d.cta_labels.length, 0);
  const multiCtaDest = destinations.find((d) => d.cta_labels.length > 0);
  out.push(
    signal("multiple_ctas", ctaCount >= 2, multiCtaDest ? [
      cite({ source_type: "external_page", source_id: multiCtaDest.destination_id, url: multiCtaDest.final_url, field: "cta_labels", phrase: multiCtaDest.cta_labels.map((c) => c.label).join(", ") }),
    ] : []),
  );

  // ---- branded_methodology ----
  const bioBrand = instagram.bio?.match(BRANDED_METHOD_PATTERN);
  const destBrand = destinations
    .map((d) => ({ d, match: destinationText(d).match(BRANDED_METHOD_PATTERN) }))
    .find((entry) => entry.match);
  const brandEvidence: EvidenceCitation[] = bioBrand
    ? [cite({ source_type: "bio", source_id: "profile", field: "bio", phrase: bioBrand[0] })]
    : destBrand?.match
      ? [cite({ source_type: "external_page", source_id: destBrand.d.destination_id, url: destBrand.d.final_url, field: "page_content", phrase: destBrand.match[0] })]
      : [];
  out.push(signal("branded_methodology", brandEvidence.length > 0, brandEvidence));

  return out;
}
