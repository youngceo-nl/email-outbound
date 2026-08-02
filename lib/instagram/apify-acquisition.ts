/*
 * Apify-backed Instagram acquisition.
 *
 * Drop-in alternative to the Steel path (lib/instagram/steel-acquisition.ts),
 * returning the same result shape so inngest/functions/acquire-profile.ts does
 * not care which one ran.
 *
 * Why this exists: Steel requires STEEL_API_KEY plus a complete managed
 * identity (cookie + proxy + label + steel_profile_id) per lead, and throws
 * before its first step when any of that is missing. Apify needs only a token,
 * manages its own proxying, and has no cookie to get challenged or quarantined
 * — which makes it the practical choice for test runs.
 *
 * Trade-off worth knowing: the Steel browser also reads Story Highlights, which
 * the Apify profile actor does not return. Highlights therefore come back as
 * `not_attempted` (unknown), never as `captured`-and-empty — an absent Highlight
 * must not read as evidence that the profile has none.
 */

import { fetchInstagramEvidenceViaApify } from "@/lib/evidence/apify";
import { normalizeInstagramEvidence } from "@/lib/evidence/instagram";
import type { InstagramEvidence } from "@/lib/qualification/types";
import type { AcquisitionStatus } from "./steel-acquisition";

export type ApifyAcquisitionResult = {
  status: AcquisitionStatus;
  instagram: InstagramEvidence;
  errors: string[];
  /** Always null — kept so the caller can treat both providers identically. */
  sessionId: string | null;
  challenge: string | null;
};

export function resolveApifyTokens(): string[] {
  const tokens = (process.env.APIFY_TOKENS ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  const single = process.env.APIFY_TOKEN?.trim();
  if (single && !tokens.includes(single)) tokens.push(single);
  return tokens;
}

export async function acquireInstagramEvidenceViaApify(input: {
  username: string;
  tokens?: string[];
}): Promise<ApifyAcquisitionResult> {
  const tokens = input.tokens?.length ? input.tokens : resolveApifyTokens();
  if (tokens.length === 0) {
    return {
      status: "failed",
      instagram: normalizeInstagramEvidence({
        username: input.username,
        user: null,
        providerError: "no Apify token configured",
        acquisitionSource: "apify",
      }),
      errors: ["no Apify token configured (APIFY_TOKEN or APIFY_TOKENS)"],
      sessionId: null,
      challenge: null,
    };
  }

  const raw = await fetchInstagramEvidenceViaApify({ token: tokens, username: input.username });
  const instagram = normalizeInstagramEvidence(raw);

  /*
   * A private account is a legitimate, permanent "cannot evaluate" — distinct
   * from a provider failure, which is worth retrying. Conflating them is how a
   * transient outage ends up looking like a wall of unqualifiable leads.
   */
  const status: AcquisitionStatus = raw.user
    ? instagram.is_private
      ? "blocked"
      : "captured"
    : "failed";

  return {
    status,
    instagram,
    errors: raw.providerError ? [raw.providerError] : [],
    sessionId: null,
    challenge: null,
  };
}
