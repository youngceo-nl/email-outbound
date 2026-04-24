"use server";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/config/settings";
import { fetchProfileMetadataDirect, InstagramDirectError } from "@/lib/instagram/direct";

export type TestCookieResponse = {
  ok: boolean;
  message: string;
  detail?: {
    probed_username: string;
    full_name: string | null;
    followers: number;
  };
};

const PROBE_USERNAMES = ["instagram", "natgeo", "nasa", "nike"];

// Sends one harmless /web_profile_info call using whatever cookie is in
// Settings (or the env var). Returns valid/invalid + a small payload so the
// user can confirm it pulled real data.
export async function testIgCookie(): Promise<TestCookieResponse> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, message: "unauthorized" };

  const settings = await getSettings(true);
  const cookie = settings.instagram_session_cookie?.trim() || process.env.INSTAGRAM_SESSION_COOKIE?.trim() || null;
  if (!cookie) {
    return { ok: false, message: "No cookie configured in Settings or env." };
  }

  // Pick a probe randomly so successive tests don't always hit the same target
  // (cheap heuristic; no actual randomness — uses cookie length mod list size).
  const probe = PROBE_USERNAMES[cookie.length % PROBE_USERNAMES.length];

  try {
    const p = await fetchProfileMetadataDirect({ username: probe, sessionCookie: cookie });
    if (!p) {
      return { ok: false, message: `IG returned no user for @${probe} — unexpected. Cookie may still work, but probe failed.` };
    }
    return {
      ok: true,
      message: `Cookie works. IG returned valid data for @${probe}.`,
      detail: {
        probed_username: probe,
        full_name: p.full_name,
        followers: p.followers,
      },
    };
  } catch (err) {
    const direct = err instanceof InstagramDirectError ? err : null;
    return {
      ok: false,
      message: direct
        ? `Cookie rejected: ${direct.message}`
        : `Network error: ${(err as Error).message}`,
    };
  }
}
