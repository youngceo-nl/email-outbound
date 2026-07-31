/*
 * Evidence certainty.
 *
 * Derived by application code from what was actually captured — never a
 * probability the model emitted about itself. Certainty answers "could we see
 * enough to decide automatically?", which is a different question from "is this
 * lead good?" and must not be conflated with the commercial-fit score.
 */

import type {
  Certainty,
  ChallengerResult,
  CommercialExtraction,
  EvidenceSnapshot,
  SignalStates,
} from "./types";
import type { CoreGateResult } from "./eligibility";
import { isYouTubeHost } from "@/lib/evidence/page-extract";

export type CertaintyResult = {
  certainty: Certainty;
  reasons: string[];
  /** Requirements that would have to be met for `high`. */
  blockers: string[];
};

export function deriveCertainty(args: {
  snapshot: EvidenceSnapshot;
  extraction: CommercialExtraction;
  track: { track: string; mixed: boolean };
  coreGate: CoreGateResult;
  challenger: ChallengerResult | null;
  challengerAgrees: boolean | null;
  citationWarnings: string[];
}): CertaintyResult {
  const { snapshot, extraction, track, coreGate, challenger, challengerAgrees } = args;
  const blockers: string[] = [];
  const reasons: string[] = [];

  // ---- Low-certainty conditions: any one is decisive. ----
  const lowReasons: string[] = [];

  const coreStates: Array<[string, SignalStates[keyof SignalStates]]> = [
    ["human_personal_brand", coreGate.states.human_personal_brand],
    ["information_funnel", coreGate.states.information_funnel],
    ["cta", coreGate.states.cta],
  ];
  for (const [name, state] of coreStates) {
    if (state === "unknown") lowReasons.push(`core signal ${name} is unknown`);
    if (state === "conflicting") lowReasons.push(`core signal ${name} is conflicting`);
  }

  if (snapshot.instagram.profile_capture_status !== "captured") {
    lowReasons.push("Instagram profile was not captured");
  }
  if (snapshot.activity.data_quality === "unreliable") {
    lowReasons.push("profile data is unreliable");
  }
  if (track.track === "uncertain" || track.mixed) {
    lowReasons.push("track is uncertain or the business model is mixed");
  }
  if (challengerAgrees === false) {
    lowReasons.push(`challenger disagrees: ${challenger?.reason?.slice(0, 160) ?? "no reason given"}`);
  }
  if (extraction.conflicts.length > 0) {
    lowReasons.push(`extractor reported conflicts: ${extraction.conflicts.slice(0, 2).join("; ")}`);
  }

  if (lowReasons.length > 0) {
    return { certainty: "low", reasons: lowReasons, blockers: lowReasons };
  }

  // ---- Requirements for high certainty ----
  if (snapshot.acquisition_sufficiency !== "sufficient") {
    blockers.push(`acquisition sufficiency is ${snapshot.acquisition_sufficiency}`);
  } else {
    reasons.push("acquisition sufficient");
  }

  if (!extraction.cta_chain_resolved) {
    blockers.push("CTA chain was not resolved to an ultimate outcome");
  }
  if (!extraction.primary_visitor_outcome || extraction.primary_visitor_outcome === "unknown") {
    blockers.push("primary visitor outcome is unknown");
  }

  /*
   * When YouTube is the profile's primary CTA the spec requires an inspected
   * video description before high certainty. Otherwise the channel is being
   * treated as an information funnel purely on the strength of it existing.
   */
  const youtubePrimary = Boolean(
    snapshot.instagram.external_link && isYouTubeHost(snapshot.instagram.external_link),
  );
  if (youtubePrimary) {
    const inspected = snapshot.youtube_videos.some(
      (video) => video.capture_status === "captured" && Boolean(video.description),
    );
    if (!inspected) {
      blockers.push("YouTube is the primary CTA but no video description was inspected");
    } else {
      reasons.push("YouTube primary CTA has an inspected video description");
    }
  }

  // Proof must be attributed to what produced it, or explicitly unknown.
  const unattributed = [...extraction.proof.claims, ...extraction.proof_attribution].filter(
    (claim) => !claim.beneficiary,
  );
  if (unattributed.length > 0) {
    blockers.push(`${unattributed.length} proof claim(s) lack a beneficiary`);
  }

  if (!coreGate.passes) {
    blockers.push("core gate does not pass");
  }
  if (challengerAgrees === null) {
    blockers.push("challenger verification has not run");
  } else if (challengerAgrees) {
    reasons.push("challenger agrees");
  }

  if (args.citationWarnings.length > 3) {
    blockers.push(`${args.citationWarnings.length} cited phrases could not be found in the snapshot`);
  }

  if (blockers.length === 0) {
    return { certainty: "high", reasons, blockers };
  }

  /*
   * One noncritical unknown surface or a challenger that has not run yet is a
   * medium, not a low. Low is reserved for evidence that actively conflicts or
   * for a core signal we could not see at all.
   */
  return { certainty: "medium", reasons, blockers };
}
