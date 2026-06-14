// Free-path CLI: scrape a YouTube channel's About page for a PUBLICLY published
// business email (no captcha). Uses the same lib the enrichment pipeline calls.
//
//   npx tsx --conditions react-server scripts/youtube/find-free.ts <channelUrl>
//
// Prints a JSON line: { email, error }.

import { findYouTubeChannelEmail } from "../../lib/youtube/about";
import { extractYouTubeChannelUrl } from "../../lib/youtube/channel-url";

async function main() {
  const raw = process.argv[2];
  if (!raw) {
    console.error("usage: npx tsx --conditions react-server scripts/youtube/find-free.ts <channelUrl>");
    process.exit(2);
  }
  const apiKey = process.env.SCRAPINGBEE_API_KEY ?? "";
  if (!apiKey) {
    console.error("SCRAPINGBEE_API_KEY not set");
    process.exit(2);
  }

  // Normalise to the canonical channel URL exactly like the pipeline does.
  const channelUrl = extractYouTubeChannelUrl(raw) ?? raw;
  console.error(`→ scraping About page for ${channelUrl}`);

  const r = await findYouTubeChannelEmail({ apiKey, channelUrl });
  console.log(JSON.stringify(r));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
