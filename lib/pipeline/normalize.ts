import type { ScrapedProfile } from "@/lib/types";

// Convert a profile URL or username to canonical lowercase username.
export function toUsername(input: string): string {
  const s = input.trim().toLowerCase();
  if (s.startsWith("http")) {
    try {
      const u = new URL(s);
      const parts = u.pathname.split("/").filter(Boolean);
      return (parts[0] ?? "").replace(/^@/, "");
    } catch {
      return s.replace(/^@/, "");
    }
  }
  return s.replace(/^@/, "");
}

export function profileUrl(username: string): string {
  return `https://www.instagram.com/${toUsername(username)}/`;
}

export function ensureProfileFields(p: Partial<ScrapedProfile>): ScrapedProfile {
  const username = toUsername(p.username ?? "");
  return {
    username,
    full_name: p.full_name ?? null,
    profile_url: p.profile_url ?? profileUrl(username),
    bio: p.bio ?? null,
    external_link: p.external_link ?? null,
    followers: p.followers ?? 0,
    following: p.following ?? 0,
    posts: p.posts ?? 0,
    is_private: p.is_private ?? false,
    is_verified: p.is_verified ?? false,
    recent_posts: p.recent_posts ?? [],
  };
}
