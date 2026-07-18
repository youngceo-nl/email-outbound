import { inngest } from "@/inngest/client";
import { refreshAndSaveYoutubeCookie, youtubeLoginConfigured, refreshAllYtAccounts } from "@/lib/youtube/refresh-cookie";
import { getSettings } from "@/lib/config/settings";

// Proactively re-mints YouTube/Google cookies on a schedule.
// Handles both the legacy single-account flow and the new multi-account managed list.
export const refreshYtCookie = inngest.createFunction(
  { id: "refresh-yt-cookie", name: "Refresh YouTube Google cookie(s)", retries: 1 },
  { cron: "0 */12 * * *" }, // twice a day
  async ({ step }) => {
    const settings = await step.run("load-settings", () => getSettings(true).catch(() => null));

    // Refresh managed yt_accounts
    const accountCount = (settings?.yt_accounts ?? []).length;
    if (accountCount > 0) {
      const accounts = await step.run("refresh-accounts", () => refreshAllYtAccounts());
      if (accounts.failed > 0 && accounts.refreshed === 0) {
        throw new Error(`All ${accounts.failed} YouTube account(s) failed to refresh`);
      }
    }

    // Legacy single-account refresh (yt_google_email / yt_google_password)
    const legacyConfigured = youtubeLoginConfigured(settings ?? undefined);
    if (legacyConfigured) {
      const result = await step.run("refresh-legacy", () => refreshAndSaveYoutubeCookie());
      if (!result.cookie) throw new Error(result.error ?? "legacy refresh failed");
    }

    if (accountCount === 0 && !legacyConfigured) {
      return { skipped: "no YouTube login configured" };
    }
    return { ok: true };
  },
);
