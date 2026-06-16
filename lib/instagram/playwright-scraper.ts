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

    // Validate cookie before navigating
    try {
      const apiRes = await ctx.request.get(
        "https://i.instagram.com/api/v1/accounts/current_user/?edit=true",
        { headers: { "X-IG-App-ID": "936619743392459" } },
      );
      const body = await apiRes.text().catch(() => "");
      if (apiRes.status() === 401 || body.includes('"require_login"')) {
        throw new Error(`IG session cookie invalid or expired (status=${apiRes.status()})`);
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("cookie invalid") || msg.includes("expired")) throw err;
      // network blip on the check — proceed anyway
    }

    try {
      await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: "networkidle", timeout: 30_000 });
    } catch {
      // networkidle timeout is fine — page is usually ready
    }

    await Promise.race([
      page.waitForSelector("header, main article, [data-testid], ._aaqt, section", { timeout: 10_000 }),
      page.waitForTimeout(6_000),
    ]).catch(() => {});
    await page.waitForTimeout(1_000);

    const pageUrl = page.url();
    if (pageUrl.includes("/accounts/login")) {
      throw new Error(`Instagram redirected to login — cookie expired or invalid.`);
    }
    if (await page.locator('input[name="username"]').count() > 0) {
      throw new Error(`Instagram showed a login form — cookie expired or invalid.`);
    }

    // Open the Following modal
    let clicked = false;
    for (const sel of [
      `a[href="/${username}/following/"]`,
      `a[href="/${username}/following"]`,
      `a[href*="/following"]`,
      `span:has-text("following")`,
    ]) {
      try {
        const el = page.locator(sel).first();
        await el.waitFor({ state: "visible", timeout: 5_000 });
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
