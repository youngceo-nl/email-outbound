import { generateTotp } from "@/lib/totp";

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

// Cookie names that constitute an Instagram session.
const AUTH_COOKIE_NAMES = new Set([
  "sessionid", "csrftoken", "ds_user_id", "ig_did", "mid", "ig_nrcb", "rur",
]);

/**
 * Drives Chromium through Instagram's web login flow and returns a Cookie header
 * string for a logged-in instagram.com session. Throws with a human-readable
 * reason when login is blocked or fails.
 */
export async function loginInstagramPlaywright(creds: {
  username: string;
  password: string;
  totp_secret?: string | null;
}): Promise<string> {
  const { chromium } = await import("playwright");

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check"],
    });
  } catch {
    browser = await chromium.launch({ headless: true });
  }

  const context = await browser.newContext({
    userAgent: UA,
    locale: "en-US",
    viewport: { width: 390, height: 844 },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  try {
    const page = await context.newPage();

    await page.goto("https://www.instagram.com/accounts/login/", {
      waitUntil: "networkidle",
      timeout: 30_000,
    });

    // Fill username
    const usernameInput = page.locator('input[name="username"]').first();
    await usernameInput.waitFor({ state: "visible", timeout: 15_000 });
    await usernameInput.fill(creds.username);

    // Fill password
    const passwordInput = page.locator('input[name="password"]').first();
    await passwordInput.fill(creds.password);

    // Submit
    const submitBtn = page.locator('button[type="submit"]').first();
    await submitBtn.click();

    // Wait for navigation or 2FA prompt
    await page.waitForTimeout(4_000);

    // 2FA
    const totpInput = page
      .locator('input[name="verificationCode"], input[aria-label*="verification" i], input[aria-label*="code" i]')
      .first();
    const totpVisible = await totpInput.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);

    if (totpVisible) {
      if (!creds.totp_secret) {
        throw new Error("Instagram requires 2FA but no TOTP secret is configured");
      }
      await totpInput.fill(generateTotp(creds.totp_secret));
      const confirmBtn = page
        .locator('button[type="button"]:has-text("Confirm"), button[type="submit"]')
        .first();
      await confirmBtn.click();
      await page.waitForTimeout(3_000);
    }

    // Dismiss "Save login info" / "Turn on notifications" interstitials
    for (let i = 0; i < 3; i++) {
      const skip = page
        .getByRole("button", { name: /not now|skip|cancel|later/i })
        .first();
      if ((await skip.count()) === 0) break;
      await skip.click({ timeout: 4_000 }).catch(() => {});
      await page.waitForTimeout(1_000);
    }

    // Detect common error messages
    const body = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
    const blocks: Array<[RegExp, string]> = [
      [/incorrect password|wrong password/i, "Incorrect password"],
      [/we detected an unusual login attempt/i, "Instagram flagged the login as unusual"],
      [/your account has been disabled/i, "Instagram account is disabled"],
      [/we couldn.?t log you in/i, "Instagram could not log in — check credentials"],
      [/suspicious activity/i, "Instagram detected suspicious activity"],
    ];
    for (const [re, msg] of blocks) {
      if (re.test(body)) throw new Error(msg);
    }

    // If still on the login page, login failed
    const currentUrl = page.url();
    if (currentUrl.includes("/accounts/login/")) {
      throw new Error("Login failed — still on login page (wrong credentials or challenge not handled)");
    }

    // Harvest cookies
    const cookies = await context.cookies(["https://www.instagram.com", "https://instagram.com"]);
    if (!cookies.some((c) => c.name === "sessionid")) {
      throw new Error(`Login did not produce a sessionid cookie — ended at ${currentUrl.slice(0, 100)}`);
    }

    // Build Cookie header (auth cookies only to keep it lean)
    const auth = cookies.filter((c) => AUTH_COOKIE_NAMES.has(c.name));
    return auth.map((c) => `${c.name}=${c.value}`).join("; ");
  } finally {
    await browser.close().catch(() => {});
  }
}
