import "server-only";
import type { DiscoveredFollowing } from "@/lib/apify/actors";

function parseProxyUrl(url: string): { server: string; username?: string; password?: string } | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    const proxy: { server: string; username?: string; password?: string } = { server: `${u.protocol}//${u.host}` };
    if (u.username) proxy.username = decodeURIComponent(u.username);
    if (u.password) proxy.password = decodeURIComponent(u.password);
    return proxy;
  } catch {
    return { server: url };
  }
}

function parseCookies(raw: string) {
  if (!raw) return [];
  const str = raw.trim().includes("=") ? raw.trim() : `sessionid=${raw.trim()}`;
  return str.split(";").flatMap((part) => {
    const eq = part.indexOf("=");
    if (eq === -1) return [];
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name) return [];
    return [{ name, value, domain: ".instagram.com", path: "/", secure: true, sameSite: "Lax" as const }];
  });
}

export async function scrapeFollowingPlaywright(opts: {
  username: string;
  cookie: string;
  limit?: number;
  proxyUrl?: string | null;
}): Promise<DiscoveredFollowing[]> {
  const { username, cookie, limit = 1000, proxyUrl = null } = opts;

  // Dynamic import so Next.js never bundles Playwright into the client build.
  const { chromium } = await import("@playwright/test");

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--flag-switches-begin",
      "--disable-site-isolation-trials",
      "--flag-switches-end",
    ],
    ...(proxyUrl ? { proxy: parseProxyUrl(proxyUrl) } : {}),
  });

  try {
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "en-US",
      timezoneId: "America/New_York",
      viewport: { width: 1280, height: 900 },
      extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    });

    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
      // @ts-expect-error intentional
      window.chrome = { runtime: {} };
    });

    const cookies = parseCookies(cookie);
    if (cookies.length === 0) throw new Error("No valid cookies parsed from cookie string");
    await ctx.addCookies(cookies);

    const page = await ctx.newPage();

    const collected: DiscoveredFollowing[] = [];
    const seen = new Set<string>();

    page.on("response", async (response) => {
      if (collected.length >= limit) return;
      const url = response.url();
      try {
        const body = await response.text();
        if (url.includes("/friendships/") && url.includes("/following")) {
          const json = JSON.parse(body);
          for (const node of (json?.users ?? []) as Record<string, unknown>[]) {
            if (!node?.username) continue;
            const key = (node.username as string).toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            collected.push({
              username: key,
              full_name: (node.full_name as string) ?? null,
              is_private: !!(node.is_private),
              is_verified: !!(node.is_verified),
              profile_pic_url: (node.profile_pic_url as string) ?? null,
              ig_user_id: String(node.pk ?? node.id ?? "") || null,
            });
          }
        }
        if (url.includes("/api/graphql") && body.includes("edge_follow")) {
          const jsonStr = body.startsWith("for (;;);") ? body.slice(9) : body;
          const json = JSON.parse(jsonStr);
          const edges = (json?.data?.user?.edge_follow?.edges ?? []) as { node: Record<string, unknown> }[];
          for (const { node } of edges) {
            if (!node?.username) continue;
            const key = (node.username as string).toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            collected.push({
              username: key,
              full_name: (node.full_name as string) ?? null,
              is_private: !!(node.is_private),
              is_verified: !!(node.is_verified),
              profile_pic_url: (node.profile_pic_url as string) ?? null,
              ig_user_id: (node.id as string) ?? null,
            });
          }
        }
      } catch {
        // unrelated API call — ignore
      }
    });

    // Visit homepage first — more natural user flow, avoids session conflicts
    try {
      await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 20_000 });
    } catch {
      // timeout fine
    }
    await page.waitForTimeout(1_500);

    // Dismiss cookie consent banner if present
    try {
      const cookieBtn = page.locator('button:has-text("Allow all cookies"), button:has-text("Accept all"), button._asz1').first();
      await cookieBtn.waitFor({ state: "visible", timeout: 4_000 });
      await cookieBtn.click();
      await page.waitForTimeout(800);
    } catch {
      // no banner
    }

    // Check login state on homepage
    const homeUrl = page.url();
    if (homeUrl.includes("/accounts/login")) {
      throw new Error("Cookie invalid or expired — Instagram redirected to login page.");
    }
    const hasLoginForm = await page.locator('input[name="username"]').count() > 0;
    if (hasLoginForm) {
      throw new Error("Cookie invalid or expired — Instagram showed login form.");
    }
    // "Log in" link in nav = not authenticated
    const hasLoginNav = await page.locator('a[href="/accounts/login/"]').count() > 0;
    if (hasLoginNav) {
      throw new Error("Cookie not accepted by Instagram — session may have expired. Update the cookie in Settings.");
    }

    // Navigate to target profile
    try {
      await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    } catch {
      // timeout fine
    }
    await page.waitForTimeout(1_500);

    // Dismiss "See photos/videos" sign-up modal if present (shown to logged-out users)
    try {
      const signupModal = page.locator('[role="dialog"]:has-text("Sign up"), [role="dialog"]:has-text("Log in")').first();
      const closeBtn = signupModal.locator('[aria-label="Close"], button:has-text("×"), svg[aria-label="Close"]').first();
      await closeBtn.waitFor({ state: "visible", timeout: 3_000 });
      await closeBtn.click();
      await page.waitForTimeout(500);
    } catch {
      // no modal
    }

    const pageUrl = page.url();
    if (pageUrl.includes("/accounts/login")) {
      throw new Error("Instagram redirected to login — cookie expired or invalid.");
    }
    if (await page.locator('input[name="username"]').count() > 0) {
      throw new Error("Instagram showed login form on profile — cookie expired or invalid.");
    }

    // Wait for profile header stats to render
    await Promise.race([
      page.waitForSelector('header section ul, header ul li, section ul li', { timeout: 8_000 }),
      page.waitForTimeout(5_000),
    ]).catch(() => {});

    // Open the Following modal — try <a>, <button>, and text-based selectors
    let clicked = false;
    const followingSelectors = [
      `a[href="/${username}/following/"]`,
      `a[href="/${username}/following"]`,
      `a[href*="/following/"]`,
      `a[href*="/following"]`,
      // Instagram sometimes renders this as a button (modal trigger)
      `button:has-text("following")`,
      `span:has-text("following")`,
      // The li containing the count+label
      `li:has-text("following")`,
    ];
    for (const sel of followingSelectors) {
      try {
        const el = page.locator(sel).first();
        await el.waitFor({ state: "visible", timeout: 3_000 });
        await el.click();
        clicked = true;
        break;
      } catch {
        // try next selector
      }
    }

    if (!clicked) {
      try {
        await page.goto(`https://www.instagram.com/${username}/following/`, {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        });
      } catch {
        // continue anyway
      }
    }

    let dialogVisible = false;
    try {
      await page.waitForSelector('[role="dialog"]', { timeout: 10_000 });
      dialogVisible = true;
    } catch {
      // no dialog — may be page-level list
    }

    if (dialogVisible) {
      if (await page.locator('[role="dialog"] input[name="username"]').count() > 0) {
        throw new Error("Instagram showed a login dialog — cookie is invalid or expired.");
      }
    } else {
      const hasPageList = await page.locator('ul li a[href*="/"], [role="list"] li').count() > 0;
      if (!hasPageList) return [];
    }

    // Scroll to paginate
    const maxScrolls = Math.ceil(limit / 10) + 30;
    let prevCount = 0;
    let stalledRounds = 0;

    for (let i = 0; i < maxScrolls && collected.length < limit; i++) {
      await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        const root = dialog ?? document.body;
        if (!root) return;
        const scrollable = [...root.querySelectorAll("*")].find((el) => {
          if ((el as HTMLElement).scrollHeight <= (el as HTMLElement).clientHeight + 10) return false;
          const s = window.getComputedStyle(el);
          return s.overflowY === "scroll" || s.overflowY === "auto";
        }) as HTMLElement | undefined;
        if (scrollable) {
          scrollable.scrollTop = scrollable.scrollHeight;
        } else {
          (dialog as HTMLElement | null)?.scrollBy(0, 800);
        }
      }).catch(() => {});

      await page.waitForTimeout(2_500);

      if (collected.length === prevCount) {
        stalledRounds++;
        if (stalledRounds >= 10) break;
      } else {
        stalledRounds = 0;
        prevCount = collected.length;
      }
    }

    return collected.slice(0, limit);
  } finally {
    await browser.close();
  }
}
