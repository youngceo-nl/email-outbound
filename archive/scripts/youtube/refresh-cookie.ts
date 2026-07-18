// CLI for the YouTube/Google cookie auto-refresher.
//
//   YT_GOOGLE_EMAIL=you@gmail.com \
//   YT_GOOGLE_PASSWORD='...' \
//   [YT_GOOGLE_TOTP_SECRET=BASE32SECRET]   # if the account has authenticator 2FA \
//   [YT_REVEAL_PROXY=http://user:pass@host:port] \
//   [HEADLESS=false]                       # watch the login happen \
//   [SAVE=true]                            # also persist to app_settings.yt_google_cookie \
//   npx tsx scripts/youtube/refresh-cookie.ts
//
// Prints the fresh Cookie header on success (or an error + exit 1). Run with
// HEADLESS=false the first few times — Google's login flow is fragile and
// watching it is the fastest way to see which wall you hit.

import { loginAndExtractCookie, refreshAndSaveYoutubeCookie } from "../../lib/youtube/refresh-cookie";

async function main() {
  const email = process.env.YT_GOOGLE_EMAIL ?? "";
  const password = process.env.YT_GOOGLE_PASSWORD ?? "";
  if (!email || !password) {
    console.error("YT_GOOGLE_EMAIL and YT_GOOGLE_PASSWORD are required");
    process.exit(2);
  }

  // SAVE=true exercises the full path (login + persist to settings + dedupe).
  if (process.env.SAVE === "true") {
    const result = await refreshAndSaveYoutubeCookie();
    if (!result.cookie) {
      console.error("refresh failed:", result.error);
      process.exit(1);
    }
    console.error("saved to app_settings.yt_google_cookie");
    console.log(result.cookie);
    return;
  }

  const cookie = await loginAndExtractCookie(
    { email, password, totpSecret: process.env.YT_GOOGLE_TOTP_SECRET || null },
    { proxy: process.env.YT_REVEAL_PROXY || null, headless: process.env.HEADLESS !== "false" },
  );
  console.log(cookie);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
