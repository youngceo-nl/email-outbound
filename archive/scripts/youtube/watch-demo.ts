// Visible demo: open Chromium, drive it to a channel's /about page, screenshot
// what the automation sees, and report whether the gated "View email address"
// button is present. No cookie/captcha needed — this just shows the browser.
//
//   HEADLESS=false npx tsx scripts/youtube/watch-demo.ts https://www.youtube.com/@mkbhd

import { chromium, type Browser } from "playwright";

const channelUrl = process.argv[2] ?? "https://www.youtube.com/@mkbhd";
const aboutUrl = channelUrl.replace(/\/+$/, "").replace(/\/about$/i, "") + "/about";
const shotPath = "/tmp/yt-about-demo.png";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function launch(headless: boolean): Promise<Browser> {
  return chromium.launch({ headless });
}

async function main() {
  const wantHeaded = process.env.HEADLESS === "false";
  let browser: Browser;
  try {
    browser = await launch(!wantHeaded);
    console.log(wantHeaded ? "launched HEADED Chromium" : "launched headless Chromium");
  } catch (e) {
    console.log("headed launch failed, falling back to headless:", e instanceof Error ? e.message : e);
    browser = await launch(true);
  }

  try {
    const ctx = await browser.newContext({ userAgent: UA, locale: "en-US", viewport: { width: 1280, height: 900 } });

    const cookieHeader = process.env.YT_GOOGLE_COOKIE ?? "";
    if (cookieHeader) {
      const cookies = cookieHeader.split(";").map((c) => c.trim()).filter(Boolean).flatMap((c) => {
        const i = c.indexOf("=");
        if (i === -1) return [];
        const name = c.slice(0, i).trim();
        const value = c.slice(i + 1).trim();
        return [".youtube.com", ".google.com"].map((domain) => ({ name, value, domain, path: "/", secure: true, sameSite: "None" as const }));
      });
      await ctx.addCookies(cookies);
      console.log(`set ${cookies.length} cookies`);
    }

    const page = await ctx.newPage();
    console.log("navigating →", aboutUrl);
    await page.goto(aboutUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // dismiss EU consent if present
    for (const name of [/accept all/i, /i agree/i]) {
      const b = page.getByRole("button", { name }).first();
      if ((await b.count()) > 0) { await b.click().catch(() => {}); break; }
    }
    await page.waitForTimeout(2500);

    const signedIn = (await page.getByRole("link", { name: /^sign in$/i }).count()) === 0;
    console.log("appears signed in:", signedIn);
    console.log("has 'View email address':", (await page.getByText(/view email address/i).count()) > 0);
    console.log("has 'Sign in to see email address':", (await page.getByText(/sign in to see email address/i).count()) > 0);

    // Dump the About dialog's visible text so we can see the exact controls.
    const dialogText = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"], tp-yt-paper-dialog, ytd-engagement-panel-section-list-renderer');
      return (dlg?.textContent || document.body.innerText || "").replace(/\s+/g, " ").slice(0, 1200);
    });
    console.log("--- about dialog text ---\n" + dialogText + "\n--- end ---");

    await page.screenshot({ path: shotPath, fullPage: false });
    console.log("screenshot saved →", shotPath);

    if (wantHeaded) await page.waitForTimeout(6000);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
