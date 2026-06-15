import { inngest } from "@/inngest/client";
import { refreshAndSaveYoutubeCookie, youtubeLoginConfigured } from "@/lib/youtube/refresh-cookie";
import { getSettings } from "@/lib/config/settings";

// Proactively re-mints the YouTube/Google cookie on a schedule so it's renewed
// BEFORE it expires, rather than only reactively when a lead enrichment fails.
// Together with the on-failure refresh in the enrich pipeline, this keeps a
// valid cookie in app_settings.yt_google_cookie without manual intervention.
//
// NOTE: the login drives real Chromium, which can't run inside a serverless
// deployment — this cron only succeeds where a browser is reachable (a worker,
// or BROWSER_WS_ENDPOINT pointing at a remote browser). It no-ops cleanly when
// no login is configured.
export const refreshYtCookie = inngest.createFunction(
  { id: "refresh-yt-cookie", name: "Refresh YouTube Google cookie", retries: 1 },
  { cron: "0 */12 * * *" }, // twice a day
  async ({ step }) => {
    const configured = await step.run("check-config", async () => {
      const settings = await getSettings(true).catch(() => null);
      return youtubeLoginConfigured(settings ?? undefined);
    });
    if (!configured) return { skipped: "no YouTube login configured" };

    const result = await step.run("refresh", () => refreshAndSaveYoutubeCookie());
    if (!result.cookie) throw new Error(result.error ?? "refresh failed");
    return { ok: true };
  },
);
