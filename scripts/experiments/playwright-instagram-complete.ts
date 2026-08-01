/*
 * Playwright Instagram acquisition proof of concept.
 *
 * QUESTION: can a local headless Chromium collect every evidence surface the
 * commercial qualification pipeline needs, without HikerAPI, ScrapingBee,
 * Apify, or any paid provider?
 *
 * EXPERIMENT ONLY:
 *   - imports nothing from the production qualification runtime except pure
 *     parsing helpers
 *   - writes no database rows and triggers no Inngest jobs
 *   - calls no AI model
 *   - performs no state-changing action; state-changing endpoints are aborted
 *     at the router (see playwright-instagram-shared.ts)
 *   - never writes cookies, session ids, or credentials to disk
 *
 * Strategy: intercept Instagram's own JSON/GraphQL responses as the page loads,
 * and fall back to the DOM for anything the network did not yield. Network data
 * is structured and complete; DOM data is truncated and formatted for humans.
 * Both paths are recorded so the report can say which surface produced what.
 *
 *   npx tsx scripts/experiments/playwright-instagram-complete.ts [username]
 */

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { type BrowserContext, type Page, type Response } from "playwright";
import { openBrowserSession, type BackendKind } from "./browser-backend";
import { extractPage } from "@/lib/evidence/page-extract";
import { parseYouTubeRef } from "@/lib/evidence/youtube";
import {
  OUTPUT_DIR,
  ensureOutputDir,
  installRouting,
  isAuthenticated,
  profileDirFor,
  seedSessionFromEnv,
  type RouteStats,
} from "./playwright-instagram-shared";
import {
  classifyResponseUrl,
  computeFieldCompleteness,
  detectChallenge,
  classifyHighlightTitle,
  parseCompactCount,
  parseHighlightTray,
  parsePostsResponse,
  parseProfileResponse,
  sanitizeDeep,
  sanitizeHtmlForDiagnostics,
  sanitizeUrl,
  type CaptureStatus,
  type NormalizedPost,
  type ParsedHighlight,
  type ParsedProfile,
  type ParsedStoryItem,
  type ResponseKind,
} from "./instagram-parsers";

/*
 * Flags: --headed (watch it run), --channel <name> (chrome, chrome-dev, …),
 * --slow-mo <ms> (pace actions so a human can follow).
 * The first non-flag argument is the username.
 */
const ARGV = process.argv.slice(2);
const FLAGS_WITH_VALUES = new Set(["--channel", "--slow-mo", "--proxy-url", "--steel-profile"]);

function flagValue(name: string): string | null {
  const index = ARGV.indexOf(`--${name}`);
  return index !== -1 && ARGV[index + 1] ? ARGV[index + 1] : null;
}

const HEADED = ARGV.includes("--headed");
const BACKEND: BackendKind = ARGV.includes("--steel") ? "steel" : "local";
const PROXY_URL = flagValue("proxy-url");
const STEEL_PROFILE = flagValue("steel-profile");
const CHANNEL = flagValue("channel");
const SLOW_MO = Number(flagValue("slow-mo") ?? (HEADED ? 300 : 0)) || 0;
const TARGET =
  ARGV.find(
    (arg, index) => !arg.startsWith("--") && !FLAGS_WITH_VALUES.has(ARGV[index - 1] ?? ""),
  )?.replace(/^@/, "") ?? "mikeradoor";
const NAV_TIMEOUT_MS = 45_000;
const MAX_EXTERNAL_DESTINATIONS = 3;
/** Enough recent posts for the qualification pipeline; the spec asks for 12–18. */
const TARGET_POST_COUNT = 18;
const MAX_YOUTUBE_VIDEOS = 3;

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

type CaptureStatuses = {
  profile: CaptureStatus;
  external_link: CaptureStatus;
  recent_posts: CaptureStatus;
  pinned_posts: CaptureStatus;
  highlight_titles: CaptureStatus;
  highlight_contents: CaptureStatus;
  external_funnel: CaptureStatus;
  youtube: CaptureStatus;
};

export type Report = {
  username: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  steel_session_id: string | null;
  proxy_source: "steel" | "external" | null;
  authenticated: boolean;
  profile: Record<string, unknown>;
  recent_posts: NormalizedPost[];
  pinned_posts: NormalizedPost[];
  highlights: Array<
    ParsedHighlight & {
      items: ParsedStoryItem[];
      capture_status: CaptureStatus;
      contents_policy?: string;
    }
  >;
  highlight_group_summary: {
    total_titles: number;
    commercial_groups: string[];
    profile_funnel_maturity: boolean;
  };
  external_destinations: unknown[];
  youtube: { channels: unknown[]; videos: unknown[] };
  capture_statuses: CaptureStatuses;
  network_diagnostics: {
    relevant_responses: Array<{ kind: ResponseKind; url_pattern: string; status: number; bytes: number }>;
    failed_responses: Array<{ url_pattern: string; status: number; reason: string }>;
  };
  field_completeness: ReturnType<typeof computeFieldCompleteness>;
  errors: string[];
  challenge: string;
  route_stats: RouteStats;
  capture_sources: Record<string, string>;
  timings: Phase[];
};

/*
 * Phase timing. Fixed settle waits dominate a scrape like this, so measuring
 * per phase is the only way to know which waits are actually load-bearing and
 * which are just padding that caps throughput.
 */
type Phase = { phase: string; ms: number; detail?: string };

function makeTimer(into: Phase[]) {
  return async function time<T>(phase: string, fn: () => Promise<T>, detail?: string): Promise<T> {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      into.push({ phase, ms: Date.now() - start, ...(detail ? { detail } : {}) });
    }
  };
}

/*
 * Wait for a CONDITION, not a fixed duration.
 *
 * Fixed settle waits were ~80% of total scrape time while real work was under
 * six seconds. Polling for the thing we actually need — the response arriving,
 * the anchors rendering — keeps the same worst case (the timeout) but returns
 * immediately in the common case.
 */
async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  pollMs = 150,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/** Collapses a URL to a stable pattern so diagnostics carry no identifiers. */
function urlPattern(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname
      .replace(/\/\d{6,}/g, "/{id}")
      .replace(/\/[A-Za-z0-9_-]{11,}\//g, "/{code}/");
    return `${parsed.hostname}${path}`;
  } catch {
    return "[unparseable]";
  }
}

// ---------------------------------------------------------------------------
// Network interception
// ---------------------------------------------------------------------------

type Captured = { kind: ResponseKind; body: unknown; url: string };

function installResponseCapture(
  context: BrowserContext,
  captured: Captured[],
  report: Report,
): void {
  context.on("response", (response: Response) => {
    const url = response.url();
    if (!/instagram\.com/i.test(url)) return;

    const contentType = response.headers()["content-type"] ?? "";
    if (!/json|javascript/i.test(contentType)) return;

    let requestBody: string | null = null;
    try {
      requestBody = response.request().postData();
    } catch {
      requestBody = null;
    }

    const kind = classifyResponseUrl(url, requestBody);
    if (kind === "other") return;

    if (!response.ok()) {
      report.network_diagnostics.failed_responses.push({
        url_pattern: urlPattern(url),
        status: response.status(),
        reason: `HTTP ${response.status()}`,
      });
      return;
    }

    // Bodies are read lazily; a failure here must not break navigation.
    void response
      .json()
      .then((body) => {
        captured.push({ kind, body, url });
        report.network_diagnostics.relevant_responses.push({
          kind,
          url_pattern: urlPattern(url),
          status: response.status(),
          bytes: JSON.stringify(body)?.length ?? 0,
        });
      })
      .catch(() => {
        report.network_diagnostics.failed_responses.push({
          url_pattern: urlPattern(url),
          status: response.status(),
          reason: "body was not valid JSON",
        });
      });
  });
}

// ---------------------------------------------------------------------------
// DOM fallbacks
// ---------------------------------------------------------------------------

/*
 * DOM readers are written as source STRINGS, not callbacks.
 *
 * tsx transpiles with esbuild's keepNames, which injects a `__name` helper into
 * every named function. page.evaluate serializes the callback's source and runs
 * it in the browser, where `__name` does not exist — every DOM read then dies
 * with "ReferenceError: __name is not defined". A string expression is sent
 * verbatim and sidesteps the transform.
 */
const PROFILE_DOM_SCRIPT = `(() => {
  const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? null;
  const meta = (name) =>
    document.querySelector('meta[property="' + name + '"], meta[name="' + name + '"]')
      ?.getAttribute("content")?.trim() ?? null;

  const headerItems = Array.from(document.querySelectorAll("header li, header span"))
    .map((el) => el.textContent ? el.textContent.trim() : "")
    .filter(Boolean);
  const pick = (word) => headerItems.find((item) => item.toLowerCase().includes(word)) ?? null;

  const bioLink = Array.from(document.querySelectorAll("header a[href]"))
    .map((el) => el.href)
    .find((href) => !/instagram\\.com/i.test(href) || /l\\.instagram\\.com/i.test(href)) ?? null;

  return {
    display_name: text("header h2") ?? text("header h1") ?? meta("og:title"),
    biography: text("header section > div:nth-child(3)") ?? meta("og:description"),
    external_link: bioLink,
    followersText: pick("follower"),
    followingText: pick("following"),
    postsText: pick("post"),
    metaDescription: meta("og:description"),
    isVerified: Boolean(document.querySelector('header svg[aria-label="Verified"]')),
    isPrivate: document.body.innerText.includes("This account is private"),
    profilePic: (document.querySelector("header img") || {}).src ?? meta("og:image"),
  };
})()`;

/*
 * Instagram renders the highlights rail as ordinary anchors to
 * /stories/highlights/<id>/ with the title as the link text. That is strictly
 * better than the highlights_tray API, which never fired on the profile page in
 * practice: the DOM gives the id AND the title, which is everything needed to
 * open the folder.
 */
const HIGHLIGHT_TITLES_DOM_SCRIPT = `(() => {
  const out = [];
  const seen = new Set();
  document.querySelectorAll('a[href*="/stories/highlights/"]').forEach((a) => {
    const href = a.getAttribute("href") || "";
    const id = (href.match(/highlights\\/(\\d+)/) || [])[1];
    const title = (a.textContent || "").trim();
    if (!id || !title || seen.has(id)) return;
    seen.add(id);
    out.push({ id: id, title: title });
  });
  return out;
})()`;

const SCROLL_SCRIPT = `window.scrollBy(0, window.innerHeight * 1.5)`;
const SCROLL_TOP_SCRIPT = `window.scrollTo(0, 0)`;
const BODY_TEXT_SCRIPT = `(document.body && document.body.innerText ? document.body.innerText.slice(0, 5000) : "")`;



async function readProfileFromDom(page: Page): Promise<Partial<ParsedProfile>> {
  return (await page.evaluate(PROFILE_DOM_SCRIPT)) as Partial<ParsedProfile>;
}

async function readHighlightTitlesFromDom(
  page: Page,
): Promise<Array<{ id: string; title: string }>> {
  return (await page.evaluate(HIGHLIGHT_TITLES_DOM_SCRIPT)) as Array<{ id: string; title: string }>;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export type CompleteAcquisitionOptions = {
  username: string;
  backend?: BackendKind;
  headed?: boolean;
  channel?: string | null;
  slowMo?: number;
  proxyUrl?: string | null;
  steelProfileId?: string | null;
  sessionCookie?: string | null;
  writeArtifacts?: boolean;
};

export async function runPlaywrightInstagramComplete(
  options: CompleteAcquisitionOptions,
): Promise<Report> {
  const target = options.username.replace(/^@/, "");
  const backend = options.backend ?? "steel";
  const headed = options.headed ?? false;
  const channel = options.channel ?? null;
  const slowMo = options.slowMo ?? 0;
  const proxyUrl = options.proxyUrl ?? null;
  const steelProfileId = options.steelProfileId ?? null;
  ensureOutputDir(profileDirFor(channel));
  const started = Date.now();

  console.log(
    `Target @${target} | backend=${backend} | ${headed ? "HEADED" : "headless"}` +
      `${backend === "local" ? (channel ? ` | channel=${channel}` : " | bundled Chromium") : ""}` +
      `${proxyUrl ? " | pinned proxy" : backend === "steel" ? " | NO proxy (direct)" : ""}` +
      `${slowMo ? ` | slowMo=${slowMo}ms` : ""}`,
  );

  const report: Report = {
    username: target,
    started_at: new Date(started).toISOString(),
    finished_at: "",
    duration_ms: 0,
    steel_session_id: null,
    proxy_source: null,
    authenticated: false,
    profile: {},
    recent_posts: [],
    pinned_posts: [],
    highlights: [],
    external_destinations: [],
    youtube: { channels: [], videos: [] },
    capture_statuses: {
      profile: "not_attempted",
      external_link: "not_attempted",
      recent_posts: "not_attempted",
      pinned_posts: "not_attempted",
      highlight_titles: "not_attempted",
      highlight_contents: "not_attempted",
      external_funnel: "not_attempted",
      youtube: "not_attempted",
    },
    highlight_group_summary: { total_titles: 0, commercial_groups: [], profile_funnel_maturity: false },
    network_diagnostics: { relevant_responses: [], failed_responses: [] },
    field_completeness: { captured_fields: [], missing_fields: [], unknown_fields: [] },
    errors: [],
    challenge: "none",
    route_stats: { blockedResources: 0, blockedStateChanging: 0 },
    capture_sources: {},
    timings: [],
  };

  const time = makeTimer(report.timings);

  const captured: Captured[] = [];
  const launchStart = Date.now();
  const session = await openBrowserSession({
    kind: backend,
    headed,
    channel,
    slowMo,
    proxyUrl,
    profileId: steelProfileId,
    sessionCookie: options.sessionCookie,
  });
  const context = session.context;
  report.steel_session_id = session.sessionId;
  report.proxy_source = session.proxySource ?? null;
  if (session.sessionId) {
    console.log(`Steel session ${session.sessionId}`);
    if (session.debugUrl) console.log(`Live viewer: ${session.debugUrl}`);
    console.log(`Proxy source: ${session.proxySource ?? "none (direct)"}`);
  }

  report.timings.push({ phase: "browser_launch", ms: Date.now() - launchStart });

  try {
    await time("routing_install", async () => {
      await installRouting(context, report.route_stats, { allowImages: headed });
      installResponseCapture(context, captured, report);
    });

    report.authenticated = await time("auth_check", () => isAuthenticated(context));
    if (!report.authenticated) {
      // Fall back to the session already configured for this repository before
      // giving up — an interactive bootstrap is only needed when neither exists.
      const seeded = await seedSessionFromEnv(context);
      if (seeded) report.authenticated = await isAuthenticated(context);
    }
    if (!report.authenticated) {
      report.errors.push(
        "authentication_required: no session in the experiment profile and no INSTAGRAM_SESSION_COOKIE configured. " +
          "Run: npx tsx scripts/experiments/playwright-instagram-login.ts (headed), then re-run this script headlessly.",
      );
    }

    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(NAV_TIMEOUT_MS);

    // ---- Profile ----
    try {
      await time("profile_nav", () =>
        page.goto(`https://www.instagram.com/${target}/`, {
          waitUntil: "domcontentloaded",
          timeout: NAV_TIMEOUT_MS,
        }),
      );
      const gotProfile = await time(
        "profile_settle_wait",
        () => waitUntil(() => captured.some((entry) => entry.kind === "profile"), 6000),
        "until profile response (max 6000ms)",
      );
      if (!gotProfile) report.errors.push("profile response did not arrive within 6s");

      const pageText = await page.evaluate(BODY_TEXT_SCRIPT) as string;
      report.challenge = detectChallenge(page.url(), pageText);

      if (report.challenge !== "none") {
        // Detected, reported, and NOT circumvented.
        report.errors.push(`Instagram challenge encountered: ${report.challenge}`);
        report.capture_statuses.profile = "unavailable";
        await captureFailureScreenshot(page, "challenge");
      } else {
        // Trigger the timeline fetch and let lazy-loaded posts arrive.
        /*
         * The timeline is NOT scrolled.
         *
         * Measured: the profile grid returns exactly one batch of 12 posts and
         * does not paginate further within any reasonable window — 0 scrolls
         * with a 4s dwell, 0 scrolls with a 10s dwell, and 4 scrolls all yield
         * the same 12. The extra posts in the sample come from the reels tab,
         * not from scrolling here. Four scrolls cost 10s and returned nothing.
         */
        await time(
          "timeline_settle",
          () =>
            waitUntil(
              () =>
                captured
                  .filter((entry) => entry.kind === "timeline")
                  .flatMap((entry) => parsePostsResponse(entry.body, "network")).length > 0,
              5000,
            ),
          "until first timeline batch (max 5000ms)",
        );
      }
    } catch (err) {
      report.errors.push(`profile navigation failed: ${message(err)}`);
      report.capture_statuses.profile = "failed";
      await captureFailureScreenshot(page, "profile");
    }

    // ---- Reels tab: the main timeline response carries no play counts ----
    if (report.challenge === "none") {
      try {
        await time(
          "reels_tab",
          async () => {
            await page.goto(`https://www.instagram.com/${target}/reels/`, {
              waitUntil: "domcontentloaded",
              timeout: NAV_TIMEOUT_MS,
            });
            /*
             * The reels tab exists to supply play counts, which the main
             * timeline omits. Wait until posts carrying views actually arrive.
             */
            // Same reasoning: this surface supplies both play counts and posts.
            await page.waitForTimeout(3000);
            await page.evaluate(SCROLL_SCRIPT);
            await page.waitForTimeout(2500);
          },
          "nav + 5500ms dwell (data-bearing)",
        );
      } catch (err) {
        report.errors.push(`reels tab failed: ${message(err)}`);
      }
    }

    // ---- Merge network profile with DOM fallback ----
    if (report.challenge === "none") {
      const networkProfile = captured
        .filter((entry) => entry.kind === "profile")
        .map((entry) => parseProfileResponse(entry.body))
        .find((parsed): parsed is ParsedProfile => Boolean(parsed?.username));

      let domProfile: Partial<ParsedProfile> & Record<string, unknown> = {};
      try {
        domProfile = (await time("profile_parse_dom", () => readProfileFromDom(page))) as typeof domProfile;
      } catch (err) {
        report.errors.push(`DOM profile read failed: ${message(err)}`);
      }

      const merged = {
        username: networkProfile?.username ?? target,
        display_name: networkProfile?.display_name ?? (domProfile.display_name as string | null) ?? null,
        biography: networkProfile?.biography ?? (domProfile.biography as string | null) ?? null,
        category: networkProfile?.category ?? null,
        external_link:
          networkProfile?.external_link ?? sanitizeUrl(domProfile.external_link as string | undefined),
        followers:
          networkProfile?.followers ?? parseCompactCount(domProfile.followersText as string | undefined),
        following:
          networkProfile?.following ?? parseCompactCount(domProfile.followingText as string | undefined),
        total_posts:
          networkProfile?.total_posts ?? parseCompactCount(domProfile.postsText as string | undefined),
        is_verified: networkProfile?.is_verified ?? (domProfile.isVerified as boolean | null) ?? null,
        is_private: networkProfile?.is_private ?? (domProfile.isPrivate as boolean | null) ?? null,
        profile_pic_url:
          networkProfile?.profile_pic_url ?? sanitizeUrl(domProfile.profilePic as string | undefined),
        profile_url: `https://www.instagram.com/${target}/`,
        user_id: networkProfile?.user_id ?? null,
      };

      report.profile = merged;
      report.capture_sources.profile = networkProfile ? "network" : "dom";
      report.capture_statuses.profile = merged.biography || merged.followers !== null ? "captured" : "failed";
      report.capture_statuses.external_link = networkProfile
        ? "captured"
        : merged.external_link
          ? "captured"
          : "unavailable";
    }

    // ---- Posts ----
    if (report.challenge === "none") {
      const parseStart = Date.now();
      const posts = captured
        .filter((entry) => entry.kind === "timeline" || entry.kind === "reels")
        .flatMap((entry) => parsePostsResponse(entry.body, "network"));
      report.timings.push({
        phase: "posts_parse",
        ms: Date.now() - parseStart,
        detail: `${captured.length} captured responses`,
      });

      const deduped = new Map<string, NormalizedPost>();
      for (const post of posts) if (!deduped.has(post.post_id)) deduped.set(post.post_id, post);
      const all = [...deduped.values()];

      /*
       * Pinning is only knowable if at least one response carried a pin marker.
       * Without that, an empty pinned array would be a claim we cannot support.
       */
      const anyPinMarker = captured
        .filter((entry) => entry.kind === "timeline")
        .some((entry) => JSON.stringify(entry.body).includes("timeline_pinned_user_ids"));

      report.pinned_posts = all.filter((post) => post.is_pinned);
      report.recent_posts = all.filter((post) => !post.is_pinned).slice(0, 18);
      report.capture_sources.recent_posts = "network";
      report.capture_statuses.recent_posts = all.length > 0 ? "captured" : "failed";
      report.capture_statuses.pinned_posts = anyPinMarker ? "captured" : "unavailable";

      if (all.length === 0) {
        report.errors.push("no timeline responses yielded parseable posts");
        await captureFailureScreenshot(page, "posts");
      }
    }

    // ---- Highlights ----
    if (report.challenge === "none") {
      let tray = captured
        .filter((entry) => entry.kind === "highlight_tray")
        .flatMap((entry) => parseHighlightTray(entry.body));

      if (tray.length === 0) {
        // The tray only loads when the highlights rail is on screen.
        try {
          await time(
            "highlight_rail_scroll",
            async () => {
              await page.evaluate(SCROLL_TOP_SCRIPT);
              // The rail is rendered when its anchors exist — poll for them.
              await waitUntil(
                async () =>
                  ((await page.evaluate(HIGHLIGHT_TITLES_DOM_SCRIPT)) as unknown[]).length > 0,
                2500,
              );
            },
            "until highlight anchors render (max 2500ms)",
          );
          tray = captured
            .filter((entry) => entry.kind === "highlight_tray")
            .flatMap((entry) => parseHighlightTray(entry.body));
        } catch {
          /* handled below */
        }
      }

      if (tray.length > 0) {
        report.capture_statuses.highlight_titles = "captured";
        report.capture_sources.highlight_titles = "network";
      } else {
        const domHighlights = await time("highlight_titles_dom", () =>
          readHighlightTitlesFromDom(page),
        ).catch(
          () => [] as Array<{ id: string; title: string }>,
        );
        if (domHighlights.length > 0) {
          tray = domHighlights.map((entry) => ({
            highlight_id: entry.id,
            title: entry.title,
            group: classifyHighlightTitle(entry.title),
            cover_url: null,
            capture_source: "dom" as const,
          }));
          report.capture_statuses.highlight_titles = "captured";
          report.capture_sources.highlight_titles = "dom";
        } else {
          /*
           * The rail was rendered and carried no highlights — that is a captured
           * empty result, not a failure. Only an unreadable page is unavailable.
           */
          report.capture_statuses.highlight_titles =
            report.capture_statuses.profile === "captured" ? "captured" : "unavailable";
        }
      }

      /*
       * Titles only, by design.
       *
       * Opening a Highlight requires an explicit "View story" click that marks
       * the story seen for the owner — an observable state change on someone
       * else's account. The titles carry the scoring value anyway: the spec
       * treats Highlights as supporting evidence that can never cause a
       * rejection, and the signal it actually uses is how many distinct
       * commercial groups are present, which grouping the titles already gives.
       */
      report.highlights = tray.map((highlight) => ({
        ...highlight,
        items: [],
        capture_status: "not_attempted" as CaptureStatus,
        contents_policy: "titles_only_by_design",
      }));
      report.capture_statuses.highlight_contents = "not_attempted";

      const groups = new Set(
        report.highlights.map((highlight) => highlight.group).filter((group) => group !== "Other"),
      );
      report.highlight_group_summary = {
        total_titles: report.highlights.length,
        commercial_groups: [...groups],
        // Two or more distinct commercial groups is the profile-funnel maturity
        // flag the scorecard uses as supporting evidence and a priority tiebreak.
        profile_funnel_maturity: groups.size >= 2,
      };
    }

    // ---- External funnel ----
    const externalLink = (report.profile as { external_link?: string | null }).external_link ?? null;
    if (externalLink) {
      const funnelPage = await context.newPage();
      funnelPage.setDefaultTimeout(NAV_TIMEOUT_MS);
      try {
        const destinations = await time("external_funnel", () =>
          inspectFunnel(funnelPage, externalLink, report),
        );
        report.external_destinations = destinations;
        report.capture_statuses.external_funnel = destinations.some(
          (destination) => (destination as { capture_status?: string }).capture_status === "captured",
        )
          ? "captured"
          : "failed";
      } catch (err) {
        report.errors.push(`funnel inspection failed: ${message(err)}`);
        report.capture_statuses.external_funnel = "failed";
      } finally {
        await funnelPage.close().catch(() => {});
      }
    } else {
      report.capture_statuses.external_funnel = "not_attempted";
    }

    // ---- YouTube ----
    const youtubeTarget = findYouTubeTarget(report);
    if (youtubeTarget) {
      const ytPage = await context.newPage();
      ytPage.setDefaultTimeout(NAV_TIMEOUT_MS);
      try {
        await time("youtube", () => inspectYouTube(ytPage, youtubeTarget, report));
        report.capture_statuses.youtube =
          report.youtube.channels.length > 0 || report.youtube.videos.length > 0 ? "captured" : "failed";
      } catch (err) {
        report.errors.push(`youtube inspection failed: ${message(err)}`);
        report.capture_statuses.youtube = "failed";
      } finally {
        await ytPage.close().catch(() => {});
      }
    } else {
      report.capture_statuses.youtube = "not_attempted";
    }
  } catch (err) {
    report.errors.push(`fatal: ${message(err)}`);
  } finally {
    const closeStart = Date.now();
    // For Steel this also releases the session, which stops the billing clock.
    await session.close();
    report.timings.push({ phase: "browser_close", ms: Date.now() - closeStart });
  }

  finalize(report, started, options.writeArtifacts ?? false);
  return report;
}

// ---------------------------------------------------------------------------
// Funnel inspection
// ---------------------------------------------------------------------------

async function inspectFunnel(page: Page, startUrl: string, report: Report): Promise<unknown[]> {
  const destinations: unknown[] = [];
  const queue: Array<{ url: string; hop: number }> = [{ url: startUrl, hop: 0 }];
  const visited = new Set<string>();

  while (queue.length > 0 && destinations.length < MAX_EXTERNAL_DESTINATIONS) {
    const item = queue.shift();
    if (!item) break;
    const canonical = sanitizeUrl(item.url);
    if (!canonical || visited.has(canonical)) continue;
    visited.add(canonical);

    const redirects: string[] = [];
    const destinationStart = Date.now();
    try {
      const response = await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      // Walk the redirect chain without exposing request headers.
      let request = response?.request().redirectedFrom() ?? null;
      while (request) {
        const from = sanitizeUrl(request.url());
        if (from) redirects.unshift(from);
        request = request.redirectedFrom();
      }
      // Give client-rendered funnel pages a moment, but only until they paint.
      await waitUntil(async () => {
        const length = ((await page.content()) ?? "").length;
        return length > 5000;
      }, 1500);

      const html = await page.content();
      const finalUrl = sanitizeUrl(page.url()) ?? canonical;
      // Reuse the production deterministic page extractor.
      const extractStart = Date.now();
      const extraction = extractPage({ html, url: finalUrl });
      report.timings.push({
        phase: `  destination_extract[hop${item.hop}]`,
        ms: Date.now() - extractStart,
        detail: `${html.length} bytes html`,
      });
      report.timings.push({
        phase: `  destination_fetch[hop${item.hop}]`,
        ms: Date.now() - destinationStart,
        detail: finalUrl.slice(0, 50),
      });

      destinations.push({
        source_url: canonical,
        final_url: finalUrl,
        redirect_chain: redirects,
        hop: item.hop,
        page_title: extraction.page_title,
        meta_description: extraction.meta_description,
        headings: extraction.headings.slice(0, 10),
        cta_labels: extraction.cta_labels.slice(0, 12),
        offer_copy: extraction.offer_copy.slice(0, 10),
        prices: extraction.prices,
        form_signals: extraction.form_signals,
        proof_claims: extraction.proof_claims,
        service_delivery_signals: extraction.service_delivery_signals,
        education_delivery_signals: extraction.education_delivery_signals,
        destination_type: extraction.destination_type,
        candidate_types: extraction.candidate_types,
        classification_state: extraction.classification_state,
        visitor_receives: extraction.visitor_receives,
        capture_source: "dom",
        capture_status: "captured" as CaptureStatus,
        error: null,
      });

      // Follow onward commercial links only from the first hop.
      if (item.hop === 0) {
        for (const link of extraction.outbound_links.slice(0, 25)) {
          if (destinations.length + queue.length >= MAX_EXTERNAL_DESTINATIONS) break;
          if (/apply|book|call|coach|program|course|training|community|join|mentor/i.test(link.label + link.url)) {
            queue.push({ url: link.url, hop: 1 });
          }
        }
      }
    } catch (err) {
      destinations.push({
        source_url: canonical,
        final_url: null,
        redirect_chain: redirects,
        hop: item.hop,
        capture_source: "dom",
        capture_status: "failed" as CaptureStatus,
        error: message(err),
      });
      report.errors.push(`destination ${canonical} failed: ${message(err)}`);
    }
  }
  return destinations;
}

/*
 * A NL/EU browser identity lands on consent.youtube.com before the channel.
 * The real destination is in the `continue` parameter; without unwrapping it the
 * YouTube surface is silently skipped.
 */
function unwrapConsent(url: string): string {
  try {
    const parsed = new URL(url);
    if (!/consent\.(youtube|google)\.com$/i.test(parsed.hostname)) return url;
    const target = parsed.searchParams.get("continue");
    return target ? decodeURIComponent(target) : url;
  } catch {
    return url;
  }
}

function findYouTubeTarget(report: Report): string | null {
  const candidates: string[] = [];
  const link = (report.profile as { external_link?: string | null }).external_link;
  if (link) candidates.push(link);
  for (const destination of report.external_destinations as Array<Record<string, unknown>>) {
    const final = destination.final_url as string | undefined;
    if (final) candidates.push(final);
  }
  for (const highlight of report.highlights) {
    for (const item of highlight.items) candidates.push(...item.outbound_urls);
  }
  const unwrapped = candidates.map(unwrapConsent);
  return unwrapped.find((candidate) => parseYouTubeRef(candidate) !== null) ?? null;
}

async function inspectYouTube(page: Page, target: string, report: Report): Promise<void> {
  const ref = parseYouTubeRef(target);
  if (!ref) return;

  const channelUrl =
    ref.kind === "video"
      ? `https://www.youtube.com/watch?v=${ref.value}`
      : ref.kind === "channel"
        ? `https://www.youtube.com/channel/${ref.value}`
        : `https://www.youtube.com/@${ref.value}`;

  // Structured page metadata beats visual selectors — YouTube changes its DOM
  // constantly but keeps ytInitialData and og: tags stable.
  await page.goto(channelUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  await page.waitForTimeout(2500);
  if (/consent\.(youtube|google)\.com/i.test(page.url())) {
    report.errors.push("youtube served a consent interstitial; channel metadata not readable");
    return;
  }
  const html = await page.content();

  const meta = (name: string): string | null => {
    const match = html.match(
      new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, "i"),
    );
    return match ? match[1] : null;
  };

  if (ref.kind === "video") {
    const description = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
    report.youtube.videos.push({
      url: channelUrl,
      title: meta("og:title"),
      description: description ? safeJsonString(description[1]).slice(0, 3000) : null,
      published_at: html.match(/"publishDate":"([^"]+)"/)?.[1] ?? null,
      views: html.match(/"viewCount":"(\d+)"/)?.[1] ?? null,
      outbound_urls: extractOutbound(description ? safeJsonString(description[1]) : ""),
      capture_source: "dom",
      capture_status: "captured",
    });
    return;
  }

  const subscriberText = html.match(/"subscriberCountText":\{"simpleText":"([^"]+)"/)?.[1] ?? null;
  const titles: string[] = [];
  const videoIds: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(
    /"videoId":"([\w-]{6,20})"[\s\S]{0,400}?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/g,
  )) {
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    videoIds.push(match[1]);
    titles.push(safeJsonString(match[2]));
    if (videoIds.length >= 12) break;
  }

  report.youtube.channels.push({
    url: channelUrl,
    name: meta("og:title"),
    handle: ref.kind === "handle" ? ref.value : null,
    description: meta("og:description"),
    subscribers: parseCompactCount(subscriberText),
    recent_video_titles: titles,
    capture_source: "dom",
    capture_status: "captured",
  });

  for (const videoId of videoIds.slice(0, MAX_YOUTUBE_VIDEOS)) {
    try {
      await page.goto(`https://www.youtube.com/watch?v=${videoId}`, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });
      await page.waitForTimeout(2000);
      const videoHtml = await page.content();
      const description = videoHtml.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
      const text = description ? safeJsonString(description[1]) : "";
      report.youtube.videos.push({
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: videoHtml.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? null,
        description: text.slice(0, 3000),
        published_at: videoHtml.match(/"publishDate":"([^"]+)"/)?.[1] ?? null,
        views: videoHtml.match(/"viewCount":"(\d+)"/)?.[1] ?? null,
        outbound_urls: extractOutbound(text),
        capture_source: "dom",
        capture_status: "captured",
      });
    } catch (err) {
      report.errors.push(`youtube video ${videoId} failed: ${message(err)}`);
    }
  }
}

function extractOutbound(text: string): string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    let url = match[0].replace(/[.,;:]+$/, "");
    const redirect = url.match(/youtube\.com\/redirect\?.*\bq=([^&]+)/i);
    if (redirect) {
      try {
        url = decodeURIComponent(redirect[1]);
      } catch {
        continue;
      }
    }
    const clean = sanitizeUrl(url);
    if (clean && !/youtube\.com|youtu\.be/i.test(clean)) out.add(clean);
    if (out.size >= 12) break;
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

async function captureFailureScreenshot(page: Page, label: string): Promise<void> {
  // Screenshots are taken only on failure and contain no credential surfaces.
  try {
    await page.screenshot({ path: `${OUTPUT_DIR}/failure-${label}.png`, fullPage: false });
  } catch {
    /* diagnostics are best effort */
  }
}

function safeJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function finalize(report: Report, started: number, writeArtifacts: boolean): void {
  const profile = report.profile as Record<string, unknown>;
  const posts = report.recent_posts;

  report.field_completeness = computeFieldCompleteness({
    present: {
      "profile.username": Boolean(profile.username),
      "profile.display_name": Boolean(profile.display_name),
      "profile.biography": Boolean(profile.biography),
      "profile.category": Boolean(profile.category),
      "profile.external_link": Boolean(profile.external_link),
      "profile.followers": profile.followers !== null && profile.followers !== undefined,
      "profile.following": profile.following !== null && profile.following !== undefined,
      "profile.total_posts": profile.total_posts !== null && profile.total_posts !== undefined,
      "profile.is_verified": profile.is_verified !== null && profile.is_verified !== undefined,
      "profile.is_private": profile.is_private !== null && profile.is_private !== undefined,
      "profile.profile_pic_url": Boolean(profile.profile_pic_url),
      recent_posts: posts.length > 0,
      "recent_posts.caption": posts.some((p) => p.caption),
      "recent_posts.taken_at": posts.some((p) => p.taken_at),
      "recent_posts.likes": posts.some((p) => p.likes !== null),
      "recent_posts.comments": posts.some((p) => p.comments !== null),
      "recent_posts.views": posts.some((p) => p.views !== null),
      pinned_posts: report.pinned_posts.length > 0,
      "highlights.titles": report.highlights.length > 0,
      external_destinations: report.external_destinations.length > 0,
    },
    surfaceStatus: {
      profile: report.capture_statuses.profile,
      posts: report.capture_statuses.recent_posts,
      pinned: report.capture_statuses.pinned_posts,
      highlights_titles: report.capture_statuses.highlight_titles,
      external: report.capture_statuses.external_funnel,
    },
    fieldSurface: {
      "profile.username": "profile",
      "profile.display_name": "profile",
      "profile.biography": "profile",
      "profile.category": "profile",
      "profile.external_link": "profile",
      "profile.followers": "profile",
      "profile.following": "profile",
      "profile.total_posts": "profile",
      "profile.is_verified": "profile",
      "profile.is_private": "profile",
      "profile.profile_pic_url": "profile",
      recent_posts: "posts",
      "recent_posts.caption": "posts",
      "recent_posts.taken_at": "posts",
      "recent_posts.likes": "posts",
      "recent_posts.comments": "posts",
      "recent_posts.views": "posts",
      pinned_posts: "pinned",
      "highlights.titles": "highlights_titles",
      external_destinations: "external",
    },
  });

  report.finished_at = new Date().toISOString();
  report.duration_ms = Date.now() - started;

  // Final sweep: nothing credential-bearing reaches disk.
  const sanitized = sanitizeDeep(report, { maxDepth: 16 });
  if (!writeArtifacts) return;
  writeFileSync(`${OUTPUT_DIR}/${report.username}-evidence.json`, JSON.stringify(sanitized, null, 2));
  writeFileSync(`${OUTPUT_DIR}/${report.username}-summary.md`, renderSummary(report));

  console.log(`\nEvidence: ${OUTPUT_DIR}/${report.username}-evidence.json`);
  console.log(`Summary:  ${OUTPUT_DIR}/${report.username}-summary.md`);
  console.log(`\nauthenticated=${report.authenticated} challenge=${report.challenge}`);
  console.log(
    `posts=${report.recent_posts.length} reels=${report.recent_posts.filter((p) => p.is_reel).length} ` +
      `pinned=${report.pinned_posts.length} highlights=${report.highlights.length} ` +
      `highlight_items=${report.highlights.reduce((n, h) => n + h.items.length, 0)} ` +
      `destinations=${report.external_destinations.length} duration=${report.duration_ms}ms`,
  );
  if (report.errors.length > 0) console.log(`errors:\n  - ${report.errors.join("\n  - ")}`);

  console.log("\n=== PHASE TIMINGS ===");
  const total = report.duration_ms;
  for (const entry of report.timings) {
    const pct = ((entry.ms / total) * 100).toFixed(1).padStart(5);
    console.log(
      `${entry.phase.padEnd(30)} ${String(entry.ms).padStart(7)}ms  ${pct}%  ${entry.detail ?? ""}`,
    );
  }
  const measured = report.timings
    .filter((entry) => !entry.phase.startsWith("  "))
    .reduce((sum, entry) => sum + entry.ms, 0);
  console.log(`${"TOTAL".padEnd(30)} ${String(total).padStart(7)}ms`);
  console.log(`${"(unattributed)".padEnd(30)} ${String(total - measured).padStart(7)}ms`);
}

function renderSummary(report: Report): string {
  const posts = report.recent_posts;
  const reels = posts.filter((post) => post.is_reel).length;
  const groups = report.highlight_group_summary;

  const row = (label: string, value: string | number) => `| ${label} | ${value} |`;

  return `# Playwright Instagram acquisition — @${report.username}

Experiment only. No production data was written and no AI model was called.

## Outcome

| Metric | Value |
|---|---|
${row("Authenticated", String(report.authenticated))}
${row("Instagram challenge", report.challenge)}
${row("Duration", `${report.duration_ms} ms`)}
${row("Recent posts", posts.length)}
${row("Reels", reels)}
${row("Pinned posts", report.pinned_posts.length)}
${row("Highlight titles", report.highlights.length)}
${row("Highlight commercial groups", groups.commercial_groups.join(", ") || "none")}
${row("Profile-funnel maturity", String(groups.profile_funnel_maturity))}
${row("Highlight contents", "not collected by design (titles only)")}
${row("External destinations", report.external_destinations.length)}
${row("YouTube channels", report.youtube.channels.length)}
${row("YouTube videos", report.youtube.videos.length)}
${row("State-changing requests blocked", report.route_stats.blockedStateChanging)}

## Capture status by surface

| Surface | Status | Source |
|---|---|---|
${Object.entries(report.capture_statuses)
  .map(([surface, status]) => `| ${surface} | ${status} | ${report.capture_sources[surface] ?? "-"} |`)
  .join("\n")}

## Field completeness

**Captured (${report.field_completeness.captured_fields.length})**
${report.field_completeness.captured_fields.map((f) => `- ${f}`).join("\n") || "- none"}

**Missing — surface was read and the field was genuinely absent (${report.field_completeness.missing_fields.length})**
${report.field_completeness.missing_fields.map((f) => `- ${f}`).join("\n") || "- none"}

**Unknown — acquisition failed, so absence proves nothing (${report.field_completeness.unknown_fields.length})**
${report.field_completeness.unknown_fields.map((f) => `- ${f}`).join("\n") || "- none"}

## Network diagnostics

Relevant responses: ${report.network_diagnostics.relevant_responses.length}
${report.network_diagnostics.relevant_responses.map((r) => `- ${r.kind}: ${r.url_pattern} (${r.status}, ${r.bytes} bytes)`).join("\n") || "- none"}

Failed responses: ${report.network_diagnostics.failed_responses.length}
${report.network_diagnostics.failed_responses.map((r) => `- ${r.url_pattern} (${r.status}) ${r.reason}`).join("\n") || "- none"}

## Errors

${report.errors.map((e) => `- ${e}`).join("\n") || "- none"}
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPlaywrightInstagramComplete({
    username: TARGET,
    backend: BACKEND,
    headed: HEADED,
    channel: CHANNEL,
    slowMo: SLOW_MO,
    proxyUrl: PROXY_URL,
    steelProfileId: STEEL_PROFILE,
    sessionCookie: process.env.INSTAGRAM_SESSION_COOKIE,
    writeArtifacts: true,
  }).catch((err) => {
    console.error("Experiment failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
