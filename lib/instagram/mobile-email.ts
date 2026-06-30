import "server-only";
import { BrowserSession } from "@/lib/instagram/browser-fetch";

// Fetches the business email a creator set in their Instagram "Contact options"
// — the same address shown behind the "Email" button in the mobile app.
// Called `public_email` in IG's private mobile API.
//
// Requires a mobile session cookie (obtained via loginInstagramMobile).
// Web session cookies return an empty user object from i.instagram.com.
//
// Two-step: web_profile_info → /users/{id}/info/
// Both requests share one Chrome session to avoid double browser startup.

const WEB_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MOBILE_UA =
  "Instagram 291.0.0.29.111 Android (30/11; 480dpi; 1080x2137; samsung; SM-G973F; beyond1; exynos9820; en_US; 493494379)";

export type MobileEmailResult = {
  email: string | null;
  error: string | null;
};

export async function fetchInstagramMobileEmail(opts: {
  username: string;
  sessionCookie: string;
  proxyUrl?: string | null;
}): Promise<MobileEmailResult> {
  const session = new BrowserSession();
  try {
    await session.init(opts.sessionCookie, opts.proxyUrl ?? null);

    // Step 1: resolve username → numeric user ID
    const r1 = await session.fetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(opts.username)}`,
      { headers: { "User-Agent": WEB_UA, "X-IG-App-ID": "936619743392459" }, timeoutMs: 15_000 },
    );

    if (r1.status === 404) return { email: null, error: "user_not_found" };
    if (r1.status === 401 || r1.status === 403) return { email: null, error: "session_rejected" };
    if (r1.status === 429) return { email: null, error: "rate_limited" };
    if (r1.status !== 200) return { email: null, error: `profile_http_${r1.status}` };

    let j1: { data?: { user?: { id?: string } } };
    try { j1 = JSON.parse(r1.body); } catch { return { email: null, error: "profile_parse_error" }; }
    const userId = j1?.data?.user?.id;
    if (!userId) return { email: null, error: "no_user_id" };

    // Extract csrftoken for the mobile API header
    const csrfMatch = opts.sessionCookie.match(/csrftoken=([^;]+)/);
    const csrf = csrfMatch ? csrfMatch[1].trim() : "";

    // Step 2: fetch full mobile user info — includes public_email
    // Requires mobile UA + mobile session cookie; web-only sessions return {"user":{}}.
    const r2 = await session.fetch(
      `https://i.instagram.com/api/v1/users/${userId}/info/`,
      {
        headers: {
          "User-Agent": MOBILE_UA,
          "X-IG-App-ID": "936619743392459",
          "X-IG-Capabilities": "3brTvwE=",
          "X-IG-Connection-Type": "WIFI",
          "X-CSRFToken": csrf,
          "Accept-Language": "en-US",
        },
        timeoutMs: 15_000,
      },
    );

    if (r2.status === 429) return { email: null, error: "rate_limited" };
    if (r2.status !== 200) return { email: null, error: `info_http_${r2.status}` };

    let j2: { user?: { public_email?: string | null } };
    try { j2 = JSON.parse(r2.body); } catch { return { email: null, error: "info_parse_error" }; }

    // If user object is empty, the session is web-only — needs mobile login
    if (!j2?.user || Object.keys(j2.user).length === 0) {
      return { email: null, error: "web_session_only" };
    }

    const raw = j2?.user?.public_email ?? null;
    if (!raw || !raw.includes("@")) return { email: null, error: "no_public_email" };
    return { email: raw.trim().toLowerCase(), error: null };

  } catch (err) {
    return { email: null, error: err instanceof Error ? err.message.slice(0, 100) : "unknown" };
  } finally {
    await session.close();
  }
}
