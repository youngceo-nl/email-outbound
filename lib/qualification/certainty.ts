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

export type RejectionConfidence = {
  /** True when the evidence is complete enough to reject without a human. */
  confident: boolean;
  blockers: string[];
};

/*
 * "Confident enough to REJECT" — deliberately a different question from
 * `deriveCertainty`'s "confident enough to APPROVE", because the two carry
 * opposite risks. Approving wrongly puts a bad lead into outreach; declining to
 * chase a clothing brand does not need the same bar.
 *
 * Conflating them deadlocked the pipeline. `decide.ts` gated every auto-reject
 * behind `certainty === "high"`, which is unreachable whenever the challenger
 * has not run — and it runs on a minority of leads. On the 2026-08-03 100-lead
 * run NOT ONE of 75 leads reached `high`, so 60 leads scoring at or below
 * `rejected_max` were routed to a human instead of being rejected. The review
 * queue was 64 leads of which only 4 genuinely needed an opinion.
 *
 * The bar here is only "did we actually SEE what we are judging" — never the
 * challenger, which exists to scrutinise approvals and real ambiguity, not to
 * confirm that a streetwear brand is a streetwear brand.
 */
export function deriveRejectionConfidence(args: {
  snapshot: EvidenceSnapshot;
  track: { track: string; mixed: boolean };
  coreGate: CoreGateResult;
  challengerAgrees: boolean | null;
}): RejectionConfidence {
  const blockers: string[] = [];

  /*
   * A challenger that ran and DISAGREED is disputing the extraction this
   * rejection would be based on — including the track classification. Acting on
   * a reading the reviewing model rejected is unsafe in either direction, so a
   * human looks. Note this is only `false`, never `null`: a challenger that was
   * never warranted has no opinion to override.
   */
  if (args.challengerAgrees === false) {
    blockers.push("challenger disputes the extraction");
  }

  if (args.snapshot.instagram.profile_capture_status !== "captured") {
    blockers.push("Instagram profile was not captured");
  }

  /*
   * The safety valve. An `absent` core signal is a finding — we looked and it
   * was not there. An `unknown` one means we never saw the surface at all, and
   * rejecting on evidence we failed to collect is how a real lead disappears
   * silently. Only `unknown` blocks; `absent` does not.
   */
  if (args.coreGate.unknown_signals.length > 0) {
    blockers.push(`core signal(s) never captured: ${args.coreGate.unknown_signals.join(", ")}`);
  }

  if (args.track.track === "uncertain" || args.track.mixed) {
    blockers.push("business model could not be determined");
  }

  if (args.snapshot.activity.data_quality === "unreliable") {
    blockers.push("profile data is unreliable");
  }

  return { confident: blockers.length === 0, blockers };
}

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
  /*
   * Conflicts force `low` ONLY while they are still unresolved. Previously this
   * fired unconditionally, which made the challenger pointless: `conflicts > 0`
   * is exactly what summons it (challenger.ts:150), so a challenged lead was
   * already condemned to `low` before its verdict was read. On the 2026-08-03
   * run all 14 challenged leads came back `low` — including the 4 the
   * challenger explicitly agreed with. Paying Opus to review a lead and then
   * ignoring the answer is worse than not asking.
   */
  if (extraction.conflicts.length > 0 && challengerAgrees !== true) {
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
  /*
   * A challenger that never ran only blocks `high` when it was actually
   * warranted. It previously blocked unconditionally, and since the challenger
   * fires on a minority of leads (14 of 77 on 2026-08-03) that alone made
   * `high` unreachable for ~82% of them — the single biggest cause of the
   * review-queue deadlock. Mirrors challengerTrigger (challenger.ts:144).
   */
  if (challengerAgrees === null) {
    const challengerWasWarranted = extraction.conflicts.length > 0 || track.mixed;
    if (challengerWasWarranted) {
      blockers.push("challenger verification has not run");
    }
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
