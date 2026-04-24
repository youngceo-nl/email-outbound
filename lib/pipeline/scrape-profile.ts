import "server-only";
import { scrapeProfiles, scrapePosts } from "@/lib/apify/actors";
import { scrapeProfileWithPostsViaScrapingBee } from "@/lib/scrapingbee/instagram";
import { logError } from "@/lib/pipeline/persist";
import { ensureProfileFields } from "@/lib/pipeline/normalize";
import type { AppSettings, ScrapedProfile } from "@/lib/types";

// Provider-aware single-profile scrape (returns profile + recent posts).
// Mirrors scrape-following.ts so the same `following_scraper_provider` setting
// governs both the following-list AND the profile/posts scrape.
export async function scrapeProfileWithFallback(opts: {
  username: string;
  settings: AppSettings;
  apifyToken: string | null;
  crawl_job_id?: string | null;
}): Promise<{ profile: ScrapedProfile; provider: "apify" | "scrapingbee" }> {
  const { username, settings } = opts;
  const sbKey = settings.scrapingbee_api_key || process.env.SCRAPINGBEE_API_KEY || "";
  const sbCookie = settings.instagram_session_cookie || process.env.INSTAGRAM_SESSION_COOKIE || null;
  const provider = settings.following_scraper_provider;

  const tryApify = async (): Promise<ScrapedProfile> => {
    if (!opts.apifyToken) throw new Error("Apify token not configured");
    const [profiles, postsByUser] = await Promise.all([
      scrapeProfiles({ token: opts.apifyToken, usernames: [username] }),
      scrapePosts({ token: opts.apifyToken, usernames: [username], limit: 12 }),
    ]);
    const p = profiles[0];
    if (!p) throw new Error(`profile not returned for ${username}`);
    return ensureProfileFields({ ...p, recent_posts: postsByUser.get(username) ?? [] });
  };

  const trySb = async (): Promise<ScrapedProfile> => {
    if (!sbKey) throw new Error("ScrapingBee API key not configured");
    const profile = await scrapeProfileWithPostsViaScrapingBee({
      apiKey: sbKey,
      username,
      sessionCookie: sbCookie,
    });
    if (!profile) throw new Error(`profile not returned for ${username} (SB)`);
    return ensureProfileFields(profile);
  };

  if (provider === "scrapingbee") {
    return { profile: await trySb(), provider: "scrapingbee" };
  }
  if (provider === "apify") {
    return { profile: await tryApify(), provider: "apify" };
  }

  // auto: apify first, sb fallback if SB key configured
  try {
    const profile = await tryApify();
    return { profile, provider: "apify" };
  } catch (apifyErr) {
    if (!sbKey) throw apifyErr;
    const msg = apifyErr instanceof Error ? apifyErr.message : String(apifyErr);
    await logError({
      context: "apify.profile.fallback",
      error_message: `Apify failed, trying ScrapingBee: ${msg}`,
      payload: { username },
      crawl_job_id: opts.crawl_job_id ?? null,
    });
    const profile = await trySb();
    return { profile, provider: "scrapingbee" };
  }
}
