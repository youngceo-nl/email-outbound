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

export function validateAcquisitionIdentity(
  identity: AcquisitionPoolEntry,
): AcquisitionPoolEntry {
  if (
    !identity.cookie.trim() ||
    !identity.proxyUrl.trim() ||
    !identity.accountUsername.trim() ||
    !identity.steelProfileId.trim()
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
}): Promise<AcquisitionResult> {
  const identity = validateAcquisitionIdentity(input.identity);
  const report = await runPlaywrightInstagramComplete({
    username: input.username,
    backend: "steel",
    proxyUrl: identity.proxyUrl,
    steelProfileId: identity.steelProfileId,
    sessionCookie: identity.cookie,
    writeArtifacts: false,
  });

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
