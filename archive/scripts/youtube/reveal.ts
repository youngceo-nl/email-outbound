// CLI / watcher for the YouTube About-page email revealer.
//
//   CAPSOLVER_API_KEY=... \
//   YT_GOOGLE_COOKIE='SID=...; HSID=...; SSID=...; ...' \
//   [PROXY_URL=http://user:pass@host:port] \
//   [HEADLESS=false]   # watch the browser \
//   npx tsx scripts/youtube/reveal.ts https://www.youtube.com/@SomeChannel
//
// Prints a JSON line: { email, businessEmailAvailable, error }.
//
// With HEADLESS=false you can watch Chromium drive the reveal + captcha solve.

import { revealYoutubeEmail } from "../../lib/youtube/reveal-email";

async function main() {
  const channelUrl = process.argv[2];
  if (!channelUrl) {
    console.error("usage: npx tsx scripts/youtube/reveal.ts <channelUrl>");
    process.exit(2);
  }

  const capsolverKey = process.env.CAPSOLVER_API_KEY ?? "";
  const googleCookie = process.env.YT_GOOGLE_COOKIE ?? "";
  const proxy = process.env.PROXY_URL || null;
  const headless = process.env.HEADLESS !== "false";

  if (!capsolverKey) { console.error("CAPSOLVER_API_KEY is required"); process.exit(2); }
  if (!googleCookie) { console.error("YT_GOOGLE_COOKIE is required (logged-in youtube.com session)"); process.exit(2); }

  const result = await revealYoutubeEmail({ channelUrl, googleCookie, capsolverKey, proxy, headless });
  console.log(JSON.stringify(result));
  process.exit(result.email ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
