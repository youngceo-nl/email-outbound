import "server-only";
import type { DiscoveredFollowing } from "@/lib/apify/actors";

const APP_BASE = "https://app.colddms.com";
const API_BASE = "https://api.colddms.com";
const POLL_INTERVAL_MS = 15_000;
// Large accounts took ~10 minutes for ~700 results in testing; this is a
// generous ceiling, not the expected duration.
const POLL_TIMEOUT_MS = 25 * 60 * 1000;

/**
 * Scrapes a following list via ColdDMS (app.colddms.com) — a paid Instagram
 * outreach SaaS whose backend does the actual Instagram-side scraping. This
 * drives a headless browser through the same steps a human takes in their
 * dashboard: log in, start an "account following" task, poll until it
 * completes, then create a list, which is what triggers the leads download.
 *
 * Reverse-engineered against ColdDMS's undocumented internal API/UI — there
 * is no public API. May break if they change their frontend. Only returns
 * usernames: this account's plan has enrichment (name/bio/follower counts)
 * locked behind an upgrade, so those fields come back null/false and get
 * filled in later by the existing profile-backfill step.
 */
export async function scrapeFollowingColdDMS(opts: {
  username: string;
  limit: number;
  email: string;
  password: string;
}): Promise<DiscoveredFollowing[]> {
  const { username, limit, email, password } = opts;

  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    await page.goto(`${APP_BASE}/find-leads`, { waitUntil: "networkidle", timeout: 30_000 });
    if (page.url().includes("sign-in") || page.url().includes("login")) {
      await login(page, email, password);
      await page.goto(`${APP_BASE}/find-leads`, { waitUntil: "networkidle", timeout: 30_000 });
    }

    const clientId = await page.evaluate(() => localStorage.getItem("client") || "");

    const startRes = await context.request.post(`${API_BASE}/scraping-tasks/account`, {
      headers: { origin: APP_BASE, referer: `${APP_BASE}/`, ...(clientId ? { client: clientId } : {}) },
      data: {
        accounts: [username],
        amount: Math.max(1, limit),
        collectType: "following",
        filters: [],
        additionalInfo: {
          followers: false,
          following: false,
          country: false,
          city: false,
          address: false,
          description: false,
          "number of posts": false,
          name: false,
          telephone: false,
        },
      },
    });
    const startBody = await startRes.json();
    const task = startBody?.response?.data?.task;
    if (!task) {
      throw new Error(`ColdDMS did not return a task for @${username}: ${JSON.stringify(startBody).slice(0, 300)}`);
    }

    const completed = await pollUntilComplete(context, task.scrapeTaskId);
    if (completed.scrapedCount === 0) {
      throw new Error(`ColdDMS scraped 0 accounts for @${username}`);
    }

    const usernames = await createListAndDownload(page, `${username}-${Date.now()}`);
    return usernames.map((u) => ({
      username: u,
      full_name: null,
      is_private: false,
      is_verified: false,
      profile_pic_url: null,
      ig_user_id: null,
    }));
  } finally {
    await browser.close();
  }
}

async function login(page: import("playwright").Page, email: string, password: string) {
  const emailField = page.locator('input[aria-label="Email"]').first();
  const passwordField = page.locator('input[aria-label="Password"]').first();
  await emailField.waitFor({ timeout: 10_000 });
  await emailField.fill(email);
  await passwordField.fill(password);
  const submitButton = page.locator('button[type="submit"]').first();
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes("sign-in") && !url.pathname.includes("login"), { timeout: 15_000 }),
    submitButton.click(),
  ]);
}

async function pollUntilComplete(context: import("playwright").BrowserContext, scrapeTaskId: number) {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const res = await context.request.post(`${API_BASE}/scraping-tasks/list`, {
      headers: { origin: APP_BASE, referer: `${APP_BASE}/` },
      data: {},
    });
    const body = await res.json();
    const task = body?.response?.data?.tasks?.find((t: { scrapeTaskId: number }) => t.scrapeTaskId === scrapeTaskId);
    if (!task) throw new Error(`ColdDMS task ${scrapeTaskId} disappeared while polling`);
    if (task.scrapeStatus === "completed") return task;
    if (task.scrapeStatus === "cancelled" || task.scrapeStatus === "failed") {
      throw new Error(`ColdDMS task ended as "${task.scrapeStatus}"`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`ColdDMS task ${scrapeTaskId} did not finish within ${POLL_TIMEOUT_MS / 60_000} minutes`);
}

// The download response only appears while a completed task's "create list"
// widget is still showing, and it disappears for good the moment a list is
// created for that task — so this can't be re-run against the same task.
async function createListAndDownload(page: import("playwright").Page, listName: string): Promise<string[]> {
  let leads: string[] = [];
  const handler = async (req: import("playwright").Request) => {
    if (!req.url().includes("scraping-tasks/download")) return;
    const res = await req.response();
    const text = res ? await res.text().catch(() => "") : "";
    try {
      const json = JSON.parse(text);
      const raw = typeof json.response === "string" ? json.response : "";
      leads = raw
        .split("\n")
        .map((l: string) => l.trim())
        .filter((l: string) => l && l.toLowerCase() !== "login");
    } catch {
      leads = [];
    }
  };
  page.on("requestfinished", handler);

  await page.reload({ waitUntil: "networkidle", timeout: 30_000 });
  const listNameInput = page.getByPlaceholder(/list name/i).or(page.locator('input[aria-label*="list" i]'));
  await listNameInput.first().fill(listName);
  await page.getByText("Create list", { exact: true }).click();
  await page.waitForTimeout(4_000);

  page.off("requestfinished", handler);
  if (leads.length === 0) {
    throw new Error("ColdDMS list creation didn't yield any leads — the download call may not have fired.");
  }
  return leads;
}
