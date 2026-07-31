/*
 * YouTube qualification evidence.
 *
 * A YouTube channel is an evidence surface, not automatically an information
 * funnel. What matters is where the descriptions send the visitor: educational
 * content whose next action is "hire my team" is still an agency funnel. So the
 * collector keeps full descriptions and outbound links, not just view counts.
 *
 * Two acquisition paths: the Data API when a key is configured, otherwise a
 * free fetch of the public watch/channel pages. Both record their capture state
 * so a missing description is never read as a missing offer.
 */

import type {
  CaptureStatus,
  YouTubeChannelEvidence,
  YouTubeVideoEvidence,
} from "@/lib/qualification/types";
import { freeFetchPage } from "./http";

export type YouTubeRef =
  | { kind: "channel"; value: string }
  | { kind: "handle"; value: string }
  | { kind: "video"; value: string };

/** Recognizes channel URLs, @handles, /c/ and /user/ legacy paths, and video links. */
export function parseYouTubeRef(raw: string | null | undefined): YouTubeRef | null {
  if (!raw) return null;
  const text = raw.trim();

  const shortVideo = text.match(/youtu\.be\/([\w-]{6,20})/i);
  if (shortVideo) return { kind: "video", value: shortVideo[1] };

  const watch = text.match(/youtube\.com\/(?:watch\?[^\s]*\bv=|shorts\/|live\/|embed\/)([\w-]{6,20})/i);
  if (watch) return { kind: "video", value: watch[1] };

  const channel = text.match(/youtube\.com\/channel\/(UC[\w-]{10,})/i);
  if (channel) return { kind: "channel", value: channel[1] };

  const handle = text.match(/youtube\.com\/@([\w.-]{2,40})/i);
  if (handle) return { kind: "handle", value: handle[1] };

  const legacy = text.match(/youtube\.com\/(?:c|user)\/([\w.-]{2,40})/i);
  if (legacy) return { kind: "handle", value: legacy[1] };

  return null;
}

/*
 * Video titles worth spending a description fetch on, per the spec's
 * prioritization list. Ordered scanning stops once the budget is spent.
 */
const RELEVANT_VIDEO_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "course", pattern: /\bcourse\b/i },
  { label: "training", pattern: /\btraining\b/i },
  { label: "masterclass", pattern: /\bmasterclass\b/i },
  { label: "webinar", pattern: /\bwebinar\b/i },
  { label: "case_study", pattern: /\bcase stud(y|ies)\b/i },
  { label: "work_with_me", pattern: /\bwork with (me|us)\b/i },
  { label: "consulting", pattern: /\bconsult(ing|ant)\b/i },
  { label: "agency", pattern: /\bagency\b/i },
  { label: "coaching", pattern: /\bcoach(ing)?\b/i },
  { label: "mentorship", pattern: /\bmentorship\b/i },
  { label: "community", pattern: /\b(community|inner circle)\b/i },
  { label: "apply", pattern: /\bappl(y|ication)\b/i },
  { label: "book", pattern: /\bbook\b/i },
  { label: "blueprint", pattern: /\b(blueprint|roadmap|framework|method|system)\b/i },
];

export function videoSelectionReason(title: string, isRecent: boolean): string | null {
  for (const { label, pattern } of RELEVANT_VIDEO_PATTERNS) {
    if (pattern.test(title)) return `title_match:${label}`;
  }
  return isRecent ? "recent_upload" : null;
}

export type YouTubeCollectionResult = {
  channels: YouTubeChannelEvidence[];
  videos: YouTubeVideoEvidence[];
  /** Commercial URLs found in descriptions, for the external collector to follow. */
  outbound_urls: string[];
};

export type YouTubeConfig = {
  apiKey: string | null;
  maxVideoDescriptions: number;
  maxRecentVideos: number;
};

export const DEFAULT_YOUTUBE_CONFIG: YouTubeConfig = {
  apiKey: null,
  maxVideoDescriptions: 3,
  maxRecentVideos: 12,
};

export async function collectYouTubeEvidence(opts: {
  urls: string[];
  /** True when YouTube is the Instagram profile's primary CTA — forces a description read. */
  isPrimaryCta: boolean;
  config?: Partial<YouTubeConfig>;
  now?: () => string;
}): Promise<YouTubeCollectionResult> {
  const config = { ...DEFAULT_YOUTUBE_CONFIG, ...opts.config };
  const now = opts.now ?? (() => new Date().toISOString());

  const channels: YouTubeChannelEvidence[] = [];
  const videos: YouTubeVideoEvidence[] = [];
  const outbound = new Set<string>();
  const seenChannels = new Set<string>();

  for (const url of opts.urls) {
    const ref = parseYouTubeRef(url);
    if (!ref) continue;

    if (ref.kind === "video") {
      const video = await fetchVideoEvidence(ref.value, "linked_from_profile", config);
      if (video) {
        videos.push(video);
        video.outbound_urls.forEach((link) => outbound.add(link));
      }
      continue;
    }

    const key = `${ref.kind}:${ref.value}`;
    if (seenChannels.has(key)) continue;
    seenChannels.add(key);

    const channel = await fetchChannelEvidence(ref, config, now);
    channels.push(channel);
    channel.outbound_urls.forEach((link) => outbound.add(link));

    if (channel.capture_status !== "captured") continue;

    // Description budget: prioritized titles first, then recency as a fallback.
    const scored = channel.recent_video_titles
      .map((title, index) => ({ title, index, reason: videoSelectionReason(title, index < 3) }))
      .filter((entry) => entry.reason !== null);

    const budget = Math.max(
      config.maxVideoDescriptions,
      opts.isPrimaryCta ? 1 : 0,
    );

    const ids = channelVideoIds.get(channel.channel_id) ?? [];
    for (const entry of scored.slice(0, budget)) {
      const videoId = ids[entry.index];
      if (!videoId) continue;
      const video = await fetchVideoEvidence(videoId, entry.reason as string, config);
      if (video) {
        videos.push(video);
        video.outbound_urls.forEach((link) => outbound.add(link));
      }
    }

    /*
     * When YouTube is the primary Instagram CTA the spec requires at least one
     * inspected description before high certainty is possible. If prioritized
     * selection found nothing, fall back to the most recent upload.
     */
    if (opts.isPrimaryCta && videos.length === 0 && ids.length > 0) {
      const video = await fetchVideoEvidence(ids[0], "primary_cta_fallback", config);
      if (video) {
        videos.push(video);
        video.outbound_urls.forEach((link) => outbound.add(link));
      }
    }
  }

  return { channels, videos, outbound_urls: [...outbound] };
}

/* Video IDs discovered per channel, keyed for the description pass above. */
const channelVideoIds = new Map<string, string[]>();

// ---------------------------------------------------------------------------
// Channel acquisition
// ---------------------------------------------------------------------------

async function fetchChannelEvidence(
  ref: Exclude<YouTubeRef, { kind: "video" }>,
  config: YouTubeConfig,
  now: () => string,
): Promise<YouTubeChannelEvidence> {
  const url =
    ref.kind === "channel"
      ? `https://www.youtube.com/channel/${ref.value}`
      : `https://www.youtube.com/@${ref.value}`;

  if (config.apiKey) {
    const viaApi = await fetchChannelViaApi(ref, config.apiKey, now);
    if (viaApi) return viaApi;
  }
  return fetchChannelViaHtml(ref, url, now);
}

type ChannelsResponse = {
  items?: Array<{
    id: string;
    snippet?: { title?: string; description?: string; customUrl?: string };
    statistics?: { subscriberCount?: string; videoCount?: string };
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
  }>;
};

async function fetchChannelViaApi(
  ref: Exclude<YouTubeRef, { kind: "video" }>,
  apiKey: string,
  now: () => string,
): Promise<YouTubeChannelEvidence | null> {
  try {
    const params = new URLSearchParams({
      part: "snippet,statistics,contentDetails",
      key: apiKey,
      ...(ref.kind === "channel" ? { id: ref.value } : { forHandle: ref.value }),
    });
    const res = await fetch(`https://www.googleapis.com/youtube/v3/channels?${params}`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as ChannelsResponse;
    const channel = json.items?.[0];
    if (!channel) return null;

    const uploads = channel.contentDetails?.relatedPlaylists?.uploads;
    const titles: string[] = [];
    const ids: string[] = [];
    if (uploads) {
      const playlistParams = new URLSearchParams({
        part: "contentDetails,snippet",
        playlistId: uploads,
        maxResults: "12",
        key: apiKey,
      });
      const playlistRes = await fetch(
        `https://www.googleapis.com/youtube/v3/playlistItems?${playlistParams}`,
        { signal: AbortSignal.timeout(12_000) },
      );
      if (playlistRes.ok) {
        const playlist = (await playlistRes.json()) as {
          items?: Array<{ snippet?: { title?: string }; contentDetails?: { videoId?: string } }>;
        };
        for (const item of playlist.items ?? []) {
          if (item.contentDetails?.videoId) {
            ids.push(item.contentDetails.videoId);
            titles.push(item.snippet?.title ?? "(untitled)");
          }
        }
      }
    }
    channelVideoIds.set(channel.id, ids);

    const description = channel.snippet?.description ?? null;
    const handle = channel.snippet?.customUrl?.replace(/^@/, "") ?? null;
    return {
      channel_id: channel.id,
      url: handle ? `https://www.youtube.com/@${handle}` : `https://www.youtube.com/channel/${channel.id}`,
      name: channel.snippet?.title ?? null,
      handle,
      description,
      subscribers: channel.statistics?.subscriberCount ? Number(channel.statistics.subscriberCount) : null,
      video_count: channel.statistics?.videoCount ? Number(channel.statistics.videoCount) : null,
      outbound_urls: extractUrls(description ?? ""),
      recent_video_titles: titles,
      capture_status: "captured",
      captured_at: now(),
      error: null,
    };
  } catch {
    return null;
  }
}

async function fetchChannelViaHtml(
  ref: Exclude<YouTubeRef, { kind: "video" }>,
  url: string,
  now: () => string,
): Promise<YouTubeChannelEvidence> {
  const channelId = ref.kind === "channel" ? ref.value : `@${ref.value}`;
  const outcome = await freeFetchPage(`${url}/videos`);

  if (!outcome.ok) {
    return {
      channel_id: channelId,
      url,
      name: null,
      handle: ref.kind === "handle" ? ref.value : null,
      description: null,
      subscribers: null,
      video_count: null,
      outbound_urls: [],
      recent_video_titles: [],
      capture_status: "failed",
      captured_at: null,
      error: `${outcome.failure.kind}: ${outcome.failure.detail}`,
    };
  }

  const html = outcome.page.html;
  const description = metaContent(html, "description");
  const name = metaContent(html, "og:title");

  // Ordered pairs from ytInitialData keep title and id aligned by position.
  const ids: string[] = [];
  const titles: string[] = [];
  const seen = new Set<string>();
  const pattern = /"videoId":"([\w-]{6,20})"[\s\S]{0,400}?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/g;
  for (const match of html.matchAll(pattern)) {
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    ids.push(match[1]);
    titles.push(decodeJsonString(match[2]));
    if (ids.length >= 12) break;
  }
  channelVideoIds.set(channelId, ids);

  const subscriberText = html.match(/"subscriberCountText":\{"simpleText":"([^"]+)"/);

  return {
    channel_id: channelId,
    url,
    name,
    handle: ref.kind === "handle" ? ref.value : null,
    description,
    subscribers: subscriberText ? parseCompactNumber(subscriberText[1]) : null,
    video_count: null,
    outbound_urls: extractUrls(description ?? ""),
    recent_video_titles: titles,
    capture_status: "captured",
    captured_at: now(),
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Video acquisition
// ---------------------------------------------------------------------------

async function fetchVideoEvidence(
  videoId: string,
  selectionReason: string,
  config: YouTubeConfig,
): Promise<YouTubeVideoEvidence | null> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  if (config.apiKey) {
    try {
      const params = new URLSearchParams({
        part: "snippet,statistics",
        id: videoId,
        key: config.apiKey,
      });
      const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`, {
        signal: AbortSignal.timeout(12_000),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          items?: Array<{
            snippet?: { title?: string; description?: string; publishedAt?: string };
            statistics?: { viewCount?: string };
          }>;
        };
        const item = json.items?.[0];
        if (item) {
          const description = item.snippet?.description ?? null;
          return {
            video_id: videoId,
            url,
            title: item.snippet?.title ?? "(untitled)",
            description,
            published_at: item.snippet?.publishedAt ?? null,
            views: item.statistics?.viewCount ? Number(item.statistics.viewCount) : null,
            outbound_urls: extractUrls(description ?? ""),
            selection_reason: selectionReason,
            capture_status: "captured",
          };
        }
      }
    } catch {
      // Fall through to the free path rather than losing the surface entirely.
    }
  }

  const outcome = await freeFetchPage(url);
  if (!outcome.ok) {
    return {
      video_id: videoId,
      url,
      title: "(unavailable)",
      description: null,
      published_at: null,
      views: null,
      outbound_urls: [],
      selection_reason: selectionReason,
      capture_status: "failed",
    };
  }

  const html = outcome.page.html;
  // shortDescription in the player response is the complete description text,
  // links included — the visible watch-page DOM truncates it.
  const shortDescription = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
  const description = shortDescription ? decodeJsonString(shortDescription[1]) : null;
  const title = metaContent(html, "og:title") ?? "(untitled)";
  const published = html.match(/"publishDate":"([^"]+)"/) ?? html.match(/"uploadDate":"([^"]+)"/);
  const views = html.match(/"viewCount":"(\d+)"/);

  return {
    video_id: videoId,
    url,
    title,
    description,
    published_at: published ? published[1] : null,
    views: views ? Number(views[1]) : null,
    outbound_urls: extractUrls(description ?? ""),
    selection_reason: selectionReason,
    capture_status: description ? "captured" : "unavailable",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SOCIAL_NOISE = /(instagram\.com|tiktok\.com|twitter\.com|x\.com|facebook\.com|discord\.gg|patreon\.com\/join|youtube\.com|youtu\.be)/i;

export function extractUrls(text: string): string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    let url = match[0].replace(/[.,;:]+$/, "");

    // YouTube wraps outbound links in a redirect; the real destination is in ?q=.
    const redirect = url.match(/youtube\.com\/redirect\?.*\bq=([^&]+)/i);
    if (redirect) {
      try {
        url = decodeURIComponent(redirect[1]);
      } catch {
        continue;
      }
    }
    if (SOCIAL_NOISE.test(url)) continue;
    out.add(url);
    if (out.size >= 15) break;
  }
  return [...out];
}

function metaContent(html: string, name: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${name}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1].trim()) return decodeHtmlEntities(match[1].trim());
  }
  return null;
}

function decodeJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\//g, "/");
  }
}

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function parseCompactNumber(raw: string): number | null {
  const match = raw.replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (Number.isNaN(value)) return null;
  const multiplier = { K: 1e3, M: 1e6, B: 1e9 }[(match[2] ?? "").toUpperCase()] ?? 1;
  return Math.round(value * multiplier);
}

/** Test seam: lets fixture tests preload the channel -> video id mapping. */
export function __setChannelVideoIds(channelId: string, ids: string[]): void {
  channelVideoIds.set(channelId, ids);
}
