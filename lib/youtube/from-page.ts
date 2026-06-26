import "server-only";
import { extractYouTubeChannelUrl } from "@/lib/youtube/channel-url";

// Follow a link-in-bio page (Linktree, Beacons, Stan, Komi, a personal site …)
// and pull the creator's YouTube channel out of it. This is far more precise than
// guessing the channel from their name via search — the "YouTube" button on their
// own landing page points straight at the real channel — so the enrich pipeline
// always tries this BEFORE falling back to a Google/Serper search.
//
// Two passes:
//   1) Static scan — most pages embed the real youtube.com URL in the server HTML
//      (anchor hrefs + a __NEXT_DATA__/JSON blob), so a regex finds it for free.
//   2) Redirect-follow — Linktree/Beacons/etc. often WRAP outbound links in their
//      own redirector (href="https://linktr.ee/st/…"), so the literal youtube.com
//      URL never appears in the HTML. For those we actually visit the candidate
//      links and see which one lands on a YouTube channel.

// A real browser UA — link-in-bio hosts (Beacons, Stan, …) return 403 to obvious
// bot user-agents, so we present as a normal Chrome to read their public pages.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Channel-shaped YouTube URLs (handle / channel-id / legacy c|user).
const CHANNEL_IN_HTML =
  /https?:\/\/(?:www\.|m\.)?youtube\.com\/(?:@[A-Za-z0-9._-]+|channel\/UC[A-Za-z0-9_-]{22}|c\/[A-Za-z0-9._-]+|user\/[A-Za-z0-9._-]+)/gi;

// Video/short/live links — used only as a fallback to resolve the owning channel
// when no direct channel link is present on the page.
const VIDEO_IN_HTML =
  /https?:\/\/(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?v=|shorts\/|live\/)[A-Za-z0-9_-]+|youtu\.be\/[A-Za-z0-9_-]+)/gi;

// Link-aggregator hosts whose outbound links are commonly redirect-wrapped.
const AGGREGATOR_HOSTS =
  /(?:^|\.)(?:linktr\.ee|beacons\.(?:ai|page)|stan\.store|komi\.io|snipfeed\.co|withkoji\.com|taplink\.cc|bio\.link|biolink\.\w+|lnk\.bio|linkin\.bio|allmylinks\.com|carrd\.co|hoo\.be|flowcode\.com|msha\.ke|solo\.to|tap\.bio|campsite\.bio|linkpop\.com|shor\.by|znap\.link)/i;

const MAX_FOLLOW = 12;          // cap on links we'll visit on an aggregator page
const FOLLOW_TIMEOUT_MS = 8_000;

export async function findYouTubeChannelFromPage(
  url: string,
): Promise<{ url: string | null; error: string | null }> {
  let html: string;
  let finalUrl = url;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { url: null, error: `http_${res.status}` };
    finalUrl = res.url || url;
    html = await res.text();
  } catch (err) {
    return { url: null, error: `fetch_failed: ${(err as Error).message.slice(0, 150)}` };
  }

  // Unescape JSON-encoded ("\/") and HTML-entity ("&amp;") URLs so the regexes
  // match links buried in __NEXT_DATA__ as readily as plain anchor hrefs.
  const decoded = html.replace(/\\\//g, "/").replace(/&amp;/g, "&");

  // 1) A direct channel link — the common case (the "YouTube" button).
  for (const m of decoded.match(CHANNEL_IN_HTML) ?? []) {
    const canon = extractYouTubeChannelUrl(m);
    if (canon) return { url: canon, error: null };
  }

  // 2) Only a video/short link on the page → resolve it to its owning channel.
  const firstVideo = decoded.match(VIDEO_IN_HTML)?.[0];
  if (firstVideo) {
    const channel = await channelFromVideo(firstVideo);
    if (channel) return { url: channel, error: null };
  }

  // 3) Aggregator / multi-link page: the YouTube button is likely redirect-wrapped
  // (no literal youtube.com in the HTML). Visit the outbound links and see which
  // one actually lands on a YouTube channel. Gated to aggregator-style pages so we
  // don't crawl a normal site's whole navigation.
  if (looksLikeAggregator(finalUrl, decoded)) {
    const candidates = rankCandidates(collectOutboundLinks(decoded, finalUrl), decoded);
    for (const href of candidates.slice(0, MAX_FOLLOW)) {
      const channel = await resolveToYouTubeChannel(href);
      if (channel) return { url: channel, error: null };
    }
    if (candidates.length > 0) return { url: null, error: "followed_links_no_youtube" };
  }

  return { url: null, error: "no_youtube_link_on_page" };
}

// Aggregator if the host is a known link-hub, OR the page is a link-hub shape:
// a __NEXT_DATA__ blob (Linktree/Beacons/etc.) or several distinct external hosts.
function looksLikeAggregator(pageUrl: string, decoded: string): boolean {
  const host = safeHost(pageUrl);
  if (host && AGGREGATOR_HOSTS.test(host)) return true;
  if (/__NEXT_DATA__|linktr\.ee|beacons|"links?":\[/i.test(decoded)) return true;
  const hosts = new Set<string>();
  for (const u of collectOutboundLinks(decoded, pageUrl)) {
    const h = safeHost(u);
    if (h) hosts.add(h);
  }
  return hosts.size >= 4;
}

// Pull absolute outbound URLs from anchor hrefs AND JSON "url" fields (the latter
// is where Linktree/Beacons keep link data). Same-host, asset, and obvious
// non-destinations are dropped.
function collectOutboundLinks(decoded: string, pageUrl: string): string[] {
  const pageHost = safeHost(pageUrl);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const u = raw.trim();
    if (!/^https?:\/\//i.test(u)) return;
    const host = safeHost(u);
    if (!host) return;
    if (host === pageHost) return;                       // same aggregator page
    if (/\.(?:png|jpe?g|gif|svg|webp|css|js|ico|woff2?|mp4|woff)(?:\?|$)/i.test(u)) return;
    if (/(?:fonts|cdn|static|assets)\.|gstatic\.com|googleapis\.com|cloudflare|sentry\.io|google-analytics/i.test(host)) return;
    if (seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };
  for (const m of decoded.matchAll(/href="([^"]+)"/gi)) push(m[1]);
  for (const m of decoded.matchAll(/"url"\s*:\s*"([^"]+)"/gi)) push(m[1]);
  return out;
}

// Visit the YouTube button first: rank links whose surrounding markup mentions
// youtube/yt/subscribe/tube ahead of the rest, so we usually hit on the 1st try.
function rankCandidates(urls: string[], decoded: string): string[] {
  const score = (u: string): number => {
    if (/youtu\.?be|youtube/i.test(u)) return 3; // literal (e.g. youtu.be shortlink)
    const i = decoded.indexOf(u);
    if (i === -1) return 0;
    const window = decoded.slice(Math.max(0, i - 140), i + u.length + 40);
    if (/youtube|youtu\.be/i.test(window)) return 2;
    if (/\byt\b|subscribe|tube|video/i.test(window)) return 1;
    return 0;
  };
  return [...urls].sort((a, b) => score(b) - score(a));
}

// Follow a (possibly redirect-wrapped) link and decide if it leads to a YouTube
// channel — via the final URL, a shallow scan of the destination HTML, or an
// owning-channel lookup when it lands on a video. One hop deep, never recursive.
async function resolveToYouTubeChannel(href: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(href, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(FOLLOW_TIMEOUT_MS),
    });
  } catch {
    return null;
  }

  // Where did we actually land?
  const landed = res.url || href;
  const canonFromUrl = extractYouTubeChannelUrl(landed);
  if (canonFromUrl) return canonFromUrl;
  if (VIDEO_IN_HTML.test(landed)) {
    VIDEO_IN_HTML.lastIndex = 0;
    const ch = await channelFromVideo(landed);
    if (ch) return ch;
  }

  // Not obviously YouTube from the URL — only bother scanning the body if the
  // destination is actually a YouTube host (avoids parsing unrelated sites).
  if (!/youtube\.com|youtu\.be/i.test(landed)) return null;
  let body: string;
  try { body = await res.text(); } catch { return null; }
  const decoded = body.replace(/\\\//g, "/").replace(/&amp;/g, "&");
  for (const m of decoded.match(CHANNEL_IN_HTML) ?? []) {
    const canon = extractYouTubeChannelUrl(m);
    if (canon) return canon;
  }
  const vid = decoded.match(VIDEO_IN_HTML)?.[0];
  if (vid) return channelFromVideo(vid);
  return null;
}

function safeHost(u: string): string | null {
  try { return new URL(u).host.toLowerCase(); } catch { return null; }
}

// Fetch a video/short page and read the owning channel id (or @handle) out of it.
async function channelFromVideo(videoUrl: string): Promise<string | null> {
  try {
    const res = await fetch(videoUrl, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const id =
      html.match(/"channelId":"(UC[A-Za-z0-9_-]{22})"/)?.[1] ??
      html.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})/)?.[1];
    if (id) return `https://www.youtube.com/channel/${id}`;
    const handle = html.match(/"canonicalBaseUrl":"\/(@[A-Za-z0-9._-]+)"/)?.[1];
    if (handle) return `https://www.youtube.com/${handle}`;
    return null;
  } catch {
    return null;
  }
}
