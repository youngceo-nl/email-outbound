/*
 * OPTIONAL headed login bootstrap for the Playwright Instagram experiment.
 *
 * EXPERIMENT ONLY — touches no production code, database, or job queue.
 *
 * Opens a visible Chromium window using the same persistent profile the
 * headless acquisition script uses. You log in by hand; Chromium stores the
 * session in the profile directory. The real test then runs headless against
 * that stored profile.
 *
 * This script never reads, prints, copies, or exports cookies. It only checks
 * whether a session cookie EXISTS so it can tell you when to stop waiting.
 *
 *   npx tsx scripts/experiments/playwright-instagram-login.ts
 */

import { chromium } from "playwright";
import { BROWSER_IDENTITY, PROFILE_DIR, ensureOutputDir, isAuthenticated } from "./playwright-instagram-shared";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

async function main(): Promise<void> {
  ensureOutputDir(PROFILE_DIR);

  console.log("Opening a visible Chromium window with the experiment profile.");
  console.log(`Profile directory: ${PROFILE_DIR}`);
  console.log("\nLog in to Instagram in the window that opens.");
  console.log("Complete any 2FA or security check yourself — this script never bypasses them.");
  console.log("The window closes automatically once a session is detected.\n");

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: BROWSER_IDENTITY.viewport,
    userAgent: BROWSER_IDENTITY.userAgent,
    locale: BROWSER_IDENTITY.locale,
    timezoneId: BROWSER_IDENTITY.timezoneId,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });

    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    let authenticated = false;

    while (Date.now() < deadline) {
      if (await isAuthenticated(context)) {
        authenticated = true;
        break;
      }
      await page.waitForTimeout(2000);
    }

    if (authenticated) {
      // Give Chromium a moment to flush the profile to disk before closing.
      await page.waitForTimeout(2000);
      console.log("Session detected and stored in the experiment profile.");
      console.log("\nNow run the real test headlessly:");
      console.log("  npx tsx scripts/experiments/playwright-instagram-complete.ts");
    } else {
      console.log("No session detected within the timeout. Nothing was stored.");
      process.exitCode = 1;
    }
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error("Login bootstrap failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
