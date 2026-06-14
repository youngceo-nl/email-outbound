// Verify your remote Chromium endpoint works, end-to-end, with no local browser.
//
//   BROWSER_WS_ENDPOINT='ws://YOUR_HOST:3000?token=YOUR_TOKEN' \
//   npx tsx scripts/youtube/test-remote.ts
//
// Connects over CDP, opens a page, prints the browser version + a page title.

import { connectBrowser } from "../../lib/browser/connect";

async function main() {
  if (!process.env.BROWSER_WS_ENDPOINT) {
    console.error("Set BROWSER_WS_ENDPOINT to your remote CDP url first.");
    process.exit(2);
  }
  console.log("connecting →", process.env.BROWSER_WS_ENDPOINT.replace(/token=[^&]+/, "token=***"));
  const { browser, context, isRemote } = await connectBrowser({
    contextOptions: { locale: "en-US", viewport: { width: 1280, height: 900 } },
  });
  try {
    console.log("connected. remote:", isRemote, "| version:", browser.version());
    const page = await context.newPage();
    await page.goto("https://example.com", { waitUntil: "domcontentloaded", timeout: 30_000 });
    console.log("page title:", await page.title());
    console.log("✓ remote browser works");
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => { console.error("✗ failed:", e instanceof Error ? e.message : e); process.exit(1); });
