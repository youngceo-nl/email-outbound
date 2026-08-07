/*
 * Builds InstagramEvidence from a lead row that the metadata backfill already
 * populated, so shadow qualification costs zero Instagram requests.
 *
 * This is the whole reason shadow mode can run today: the evidence-first
 * pipeline's Instagram surface is satisfied from cache, and only the EXTERNAL
 * surfaces (bio link, YouTube) are fetched live. No session, no proxy, no
 * scraping budget.
 *
 * The delicate part is capture state. A cached row cannot distinguish "this
 * profile has no bio link" from "nobody ever looked", and the pipeline treats
 * those completely differently — unknown must never be scored as absent. So
 * every field here is marked from what the row actually proves, and anything
 * the backfill does not collect (story highlights) stays not_attempted rather
 * than being quietly downgraded to an empty capture.
 */

import { normalizeInstagramEvidence, type RawInstagramUser } from "@/lib/evidence/instagram";
import type { InstagramEvidence } from "./types";
import type { RecentPost } from "@/lib/types";

export type CachedLeadProfile = {
  username: string;
  full_name: string | null;
  bio: string | null;
  external_link: string | null;
  is_private: boolean;
  is_verified: boolean;
  followers: number | null;
  following: number | null;
  posts: number | null;
  recent_posts: RecentPost[] | null;
  /** Signed, short-lived Instagram CDN URL, when the backfill captured one. */
  profile_pic_url?: string | null;
};

/**
 * True when the backfill demonstrably ran for this row. Bio and follower count
 * are the two fields it always writes, so either one present is proof the
 * profile surface was really fetched.
 */
export function leadHasCapturedProfile(lead: CachedLeadProfile): boolean {
  return Boolean(lead.bio) || lead.followers != null || lead.posts != null;
}

export function instagramEvidenceFromLead(
  lead: CachedLeadProfile,
  capturedAt?: string,
): InstagramEvidence {
  const profileCaptured = leadHasCapturedProfile(lead);

  if (!profileCaptured) {
    /*
     * Nothing was ever fetched. Handing the normalizer a null user marks every
     * downstream surface unknown, which is what sends this lead to data_retry
     * instead of letting it be judged on absent evidence.
     */
    return normalizeInstagramEvidence({
      username: lead.username,
      user: null,
      extractionMethod: "provider",
      capturedAt,
    });
  }

  const posts = lead.recent_posts ?? [];

  const user: RawInstagramUser = {
    username: lead.username,
    full_name: lead.full_name ?? undefined,
    biography: lead.bio ?? undefined,
    external_url: lead.external_link ?? undefined,
    is_verified: lead.is_verified,
    is_private: lead.is_private,
    profile_pic_url: lead.profile_pic_url ?? undefined,
    edge_followed_by: lead.followers != null ? { count: lead.followers } : undefined,
    edge_follow: lead.following != null ? { count: lead.following } : undefined,
    edge_owner_to_timeline_media: {
      ...(lead.posts != null ? { count: lead.posts } : {}),
      edges: posts.map((post) => ({ node: toRawPostNode(post) })),
    },
  };

  const evidence = normalizeInstagramEvidence({
    username: lead.username,
    user,
    extractionMethod: "provider",
    // The backfill never opens the highlight tray, so titles are unknown here.
    // Marking them "unavailable" would tell the scorer this creator has no
    // highlights, which is a fact we do not have.
    highlightsCaptureStatus: "not_attempted",
    capturedAt,
  });

  /*
   * The normalizer infers post capture state from whether edges were returned.
   * An empty cached array is genuinely ambiguous — an inactive account and a
   * partial backfill look identical — so it is forced back to unknown.
   */
  if (posts.length === 0) {
    return {
      ...evidence,
      recent_posts_capture_status: "not_attempted",
      pinned_posts_capture_status: "not_attempted",
    };
  }

  /*
   * Pins are only known if the scrape recorded the flag at all. When no post
   * carries is_pinned, we cannot tell "no pinned posts" from "pins not
   * recorded", so the pinned surface stays unknown even though posts captured.
   */
  const pinRecorded = posts.some((post) => post.is_pinned != null);
  if (!pinRecorded) {
    return { ...evidence, pinned_posts_capture_status: "not_attempted" };
  }

  return evidence;
}

function toRawPostNode(post: RecentPost) {
  const takenAt = post.taken_at ? Date.parse(post.taken_at) : NaN;

  return {
    is_video: post.is_reel ?? undefined,
    is_reel: post.is_reel ?? undefined,
    ...(post.views != null ? { video_view_count: post.views } : {}),
    ...(post.likes != null ? { edge_liked_by: { count: post.likes } } : {}),
    ...(post.comments != null ? { edge_media_to_comment: { count: post.comments } } : {}),
    ...(post.caption
      ? { edge_media_to_caption: { edges: [{ node: { text: post.caption } }] } }
      : {}),
    ...(Number.isFinite(takenAt) ? { taken_at_timestamp: Math.floor(takenAt / 1000) } : {}),
    ...(post.thumbnail_url ? { display_url: post.thumbnail_url } : {}),
    ...(post.shortcode ? { shortcode: post.shortcode } : {}),
    // pinned_for_users is the normalizer's pin signal; a non-empty array means
    // pinned. Only set when the cached row actually recorded the flag.
    ...(post.is_pinned === true ? { pinned_for_users: [{}] } : {}),
  };
}
