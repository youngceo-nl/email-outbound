import type { InstagramEvidence } from "@/lib/qualification/types";
import { instagramEvidenceFromLead } from "@/lib/qualification/from-lead";
import type { RecentPost } from "@/lib/types";
import type { AcquisitionPoolEntry } from "./cookie-pool";
import {
  runPlaywrightInstagramComplete,
  type Report,
} from "../../scripts/experiments/playwright-instagram-complete";

export type AcquisitionStatus = "captured" | "blocked" | "challenge" | "failed";

export type AcquisitionResult = {
  status: AcquisitionStatus;
  instagram: InstagramEvidence;
  report: Report;
  sessionId: string | null;
  challenge: string | null;
};

/*
 * Distinguishes "the container/session is unhealthy" from "this account was
 * blocked or challenged". Found on 2026-08-03: a self-hosted Steel instance
 * degraded across ~13 sequential real sessions (10s -> 63s, a clear climb —
 * runPlaywrightInstagramComplete's own internal try/catches only cover page
 * operations, not a slow/hanging session-create call, which sits before any
 * of that), then began failing new session-create calls in under 2s, and
 * finally crashed on an unhandled exception in its own CDP code. Nothing on
 * our side bounded how long a single acquisition could run, so the pipeline
 * had no chance to notice the climb or stop before the crash.
 *
 * A timeout here must never be treated as evidence against the ACCOUNT — it
 * says nothing about that identity's cookie or proxy, so the caller must not
 * quarantine on this error the way it does for a real Instagram challenge.
 */
export class AcquisitionTimeoutError extends Error {
  constructor(username: string, ms: number) {
    super(`Acquisition for @${username} exceeded ${Math.round(ms / 1000)}s — the browser backend is likely degraded`);
    this.name = "AcquisitionTimeoutError";
  }
}

/** Generous relative to real sessions (usually 10-30s); bounds the worst case. */
export const ACQUISITION_TIMEOUT_MS = 90_000;

/** Small, directly-testable primitive — no need to mock the real acquisition chain. */
export function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(onTimeout()), ms)),
  ]);
}

export function validateAcquisitionIdentity(
  identity: AcquisitionPoolEntry,
): AcquisitionPoolEntry {
  if (
    !identity.cookie.trim() ||
    !identity.proxyUrl.trim() ||
    !identity.accountUsername.trim()
  ) {
    throw new Error("A complete acquisition identity is required");
  }
  return identity;
}

export function classifyAcquisitionStatus(input: {
  authenticated: boolean;
  challenge: string;
  profileCaptured: boolean;
  errors: string[];
}): AcquisitionStatus {
  if (input.challenge !== "none") return "challenge";
  if (!input.authenticated) return "failed";
  if (input.profileCaptured) return "captured";
  if (input.errors.some((error) => /private|not found|blocked/i.test(error))) return "blocked";
  return "failed";
}

export async function acquireInstagramEvidence(input: {
  username: string;
  identity: AcquisitionPoolEntry;
  /** Sourced from app_settings by the caller; falls back to STEEL_API_KEY. */
  steelApiKey?: string | null;
  /** Sourced from app_settings; falls back to STEEL_BASE_URL. Self-hosted only. */
  steelBaseUrl?: string | null;
  /*
   * Cloudflare Access service token, when the self-hosted Steel is behind it.
   * browser-backend falls back to CF_ACCESS_CLIENT_ID/SECRET from the
   * environment — which is where infra secrets live per CLAUDE.md — so passing
   * these is an override, not a requirement.
   */
  cfAccessClientId?: string | null;
  cfAccessClientSecret?: string | null;
  /** Overridable for tests; defaults to ACQUISITION_TIMEOUT_MS. */
  timeoutMs?: number;
}): Promise<AcquisitionResult> {
  const identity = validateAcquisitionIdentity(input.identity);
  const timeoutMs = input.timeoutMs ?? ACQUISITION_TIMEOUT_MS;
  const report = await withTimeout(
    runPlaywrightInstagramComplete({
      username: input.username,
      backend: "steel",
      proxyUrl: identity.proxyUrl,
      steelProfileId: identity.steelProfileId,
      sessionCookie: identity.cookie,
      steelApiKey: input.steelApiKey ?? null,
      steelBaseUrl: input.steelBaseUrl ?? null,
      cfAccessClientId: input.cfAccessClientId ?? null,
      cfAccessClientSecret: input.cfAccessClientSecret ?? null,
      writeArtifacts: false,
    }),
    timeoutMs,
    () => new AcquisitionTimeoutError(input.username, timeoutMs),
  );

  const profile = report.profile as {
    display_name?: string | null;
    biography?: string | null;
    external_link?: string | null;
    followers?: number | null;
    following?: number | null;
    total_posts?: number | null;
    is_private?: boolean | null;
    is_verified?: boolean | null;
  };
  const recentPosts: RecentPost[] = [...report.pinned_posts, ...report.recent_posts].map((post) => ({
    caption: post.caption,
    likes: post.likes,
    comments: post.comments,
    views: post.views,
    taken_at: post.taken_at,
    is_reel: post.is_reel,
    is_pinned: post.is_pinned,
  }));

  const normalized = instagramEvidenceFromLead(
    {
      username: report.username,
      full_name: profile.display_name ?? null,
      bio: profile.biography ?? null,
      external_link: profile.external_link ?? null,
      is_private: profile.is_private ?? false,
      is_verified: profile.is_verified ?? false,
      followers: profile.followers ?? null,
      following: profile.following ?? null,
      posts: profile.total_posts ?? null,
      recent_posts: recentPosts,
    },
    report.finished_at,
  );

  const status = classifyAcquisitionStatus({
    authenticated: report.authenticated,
    challenge: report.challenge,
    profileCaptured: report.capture_statuses.profile === "captured",
    errors: report.errors,
  });

  return {
    status,
    instagram: {
      ...normalized,
      category: (report.profile as { category?: string | null }).category ?? null,
      profile_extraction_method: "combined",
      external_link_capture_status: report.capture_statuses.external_link,
      recent_posts_capture_status: report.capture_statuses.recent_posts,
      pinned_posts_capture_status: report.capture_statuses.pinned_posts,
      story_highlight_titles: report.highlights.map((highlight) => highlight.title),
      story_highlights_capture_status: report.capture_statuses.highlight_titles,
      story_highlights_captured_at:
        report.capture_statuses.highlight_titles === "captured" ? report.finished_at : null,
      profile_capture_status:
        status === "captured"
          ? report.capture_statuses.profile
          : status === "blocked"
            ? "unavailable"
            : "failed",
    },
    report,
    sessionId: report.steel_session_id,
    challenge: report.challenge === "none" ? null : report.challenge,
  };
}
