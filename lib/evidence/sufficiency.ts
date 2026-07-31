/*
 * Data quality and universal exclusions — spec Chapter 3.
 *
 * The job here is to keep two very different failures apart:
 *   - "we could not see the profile"  -> retry / data-quality queue
 *   - "we saw the profile and it is disqualifying" -> deterministic reject
 *
 * Only reliable, ICP-independent disqualifiers run before the AI call. Anything
 * needing interpretation across bio, CTA, and landing pages belongs to the
 * post-extraction business-model gate.
 */

import type { DataQuality, InstagramEvidence } from "@/lib/qualification/types";

export type SufficiencyVerdict = "sufficient" | "retryable" | "review_required" | "excluded";

export type SufficiencyReason =
  | "profile_capture_failed"
  | "profile_unavailable"
  | "private_profile_no_public_evidence"
  | "no_bio_or_metadata"
  | "posts_claimed_but_none_returned"
  | "post_sample_incomplete"
  | "obvious_non_icp_identity"
  | "bio_only_evidence";

export type SufficiencyResult = {
  verdict: SufficiencyVerdict;
  data_quality: DataQuality;
  reasons: SufficiencyReason[];
  /** Evidence text that caused an exclusion, so a reviewer can audit it. */
  exclusion_evidence: string | null;
};

/*
 * Identity categories that are reliably outside any commercial ICP. Matched
 * against the display name, username, and category only — never the bio, where
 * a legitimate coach may well use the word "memes" in passing.
 */
const NON_ICP_IDENTITY_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bfan\s?(page|account|club)\b/i, label: "fan page" },
  { pattern: /\bparody\b/i, label: "parody account" },
  { pattern: /\bmeme(s)?\s?(page|account)\b/i, label: "meme page" },
  { pattern: /\b(gossip|paparazzi)\b/i, label: "gossip account" },
  { pattern: /\brepost(s)?\s?(page|account)\b/i, label: "repost page" },
  { pattern: /\bquotes?\s?page\b/i, label: "quotes page" },
  { pattern: /\bnews\s?(page|account|network)\b/i, label: "news page" },
];

export function assessSufficiency(evidence: InstagramEvidence): SufficiencyResult {
  const reasons: SufficiencyReason[] = [];

  // ---- Acquisition failures come first: they are not ICP judgments. ----
  if (evidence.profile_capture_status === "failed") {
    return {
      verdict: "retryable",
      data_quality: "unreliable",
      reasons: ["profile_capture_failed"],
      exclusion_evidence: null,
    };
  }
  if (evidence.profile_capture_status !== "captured") {
    return {
      verdict: "retryable",
      data_quality: "unreliable",
      reasons: ["profile_unavailable"],
      exclusion_evidence: null,
    };
  }

  // ---- Reliable universal exclusions ----
  const identityText = [evidence.display_name, evidence.username, evidence.category]
    .filter(Boolean)
    .join(" ");
  for (const { pattern, label } of NON_ICP_IDENTITY_PATTERNS) {
    const match = identityText.match(pattern);
    if (match) {
      return {
        verdict: "excluded",
        data_quality: "complete",
        reasons: ["obvious_non_icp_identity"],
        exclusion_evidence: `${label}: "${match[0]}" in identity "${identityText}"`,
      };
    }
  }

  const hasBio = Boolean(evidence.bio ?? evidence.instagram_meta_description);

  /*
   * A private profile is only excluded when it also gives us nothing to read.
   * A private account with a bio advertising a coaching offer is still a
   * legitimate lead, so it goes to review rather than the bin.
   */
  if (evidence.is_private) {
    if (!hasBio && !evidence.external_link) {
      return {
        verdict: "excluded",
        data_quality: "complete",
        reasons: ["private_profile_no_public_evidence"],
        exclusion_evidence: "private profile with no bio, metadata, or external link",
      };
    }
    reasons.push("bio_only_evidence");
  }

  if (!hasBio) reasons.push("no_bio_or_metadata");

  // ---- Data quality classification ----
  const claimsPosts = (evidence.total_posts ?? 0) > 0;
  const postsCaptured = evidence.recent_posts_capture_status === "captured";
  const postSample = evidence.recent_posts.length + evidence.pinned_posts.length;

  let dataQuality: DataQuality;
  if (claimsPosts && !postsCaptured) {
    reasons.push("posts_claimed_but_none_returned");
    dataQuality = "unreliable";
  } else if (postsCaptured && postSample === 0 && claimsPosts) {
    reasons.push("posts_claimed_but_none_returned");
    dataQuality = "unreliable";
  } else if (postsCaptured && postSample > 0 && hasBio) {
    dataQuality = "complete";
  } else if (hasBio) {
    reasons.push("post_sample_incomplete");
    dataQuality = "partial";
  } else {
    dataQuality = "unreliable";
  }

  /*
   * Unreliable data is a retry, never a rejection: the spec is explicit that a
   * missing post sample must not be read as an inactive account. If the bio
   * alone still carries commercial evidence, the caller may proceed to a
   * bio-only score after the retry budget is spent.
   */
  if (dataQuality === "unreliable") {
    return {
      verdict: hasBio ? "review_required" : "retryable",
      data_quality: "unreliable",
      reasons,
      exclusion_evidence: null,
    };
  }

  if (!hasBio) {
    return {
      verdict: "review_required",
      data_quality: dataQuality,
      reasons,
      exclusion_evidence: null,
    };
  }

  return { verdict: "sufficient", data_quality: dataQuality, reasons, exclusion_evidence: null };
}
