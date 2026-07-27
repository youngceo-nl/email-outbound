import "server-only";

/*
 * YouTube collection — v3 §2.3. Creators dump their entire offer stack into
 * video descriptions: program names, prices, payment plans, application links.
 * It is the single richest source for the offer ladder, and until now it was
 * unread.
 *
 * YouTube Data API v3, key from settings or env. Conservative discovery on
 * purpose: only channels the prospect explicitly links (bio or external link)
 * are collected. A same-name search can attach the wrong person's channel to a
 * report that greets them by name — the v3 spec's own rule is "do not attach a
 * property on a handle collision alone", so no link means no collection.
 */

export type YouTubeCollection = {
  channelId: string;
  title: string;
  handle: string | null;
  url: string;
  subscribers: number | null;
  videoCount: number | null;
  /** Uploads in the last 30 days, from the sampled videos. */
  uploadsLast30Days: number;
  videos: Array<{ title: string; views: number | null; publishedAt: string; url: string }>;
  /** Prices found in video descriptions, ladder-ready. */
  capturedPrices: Array<{ raw: string; label: string | null; url: string; source: string; context: string }>;
};

const API = "https://www.googleapis.com/youtube/v3";

/** youtube.com/@handle, /channel/UC…, /c/name, /user/name, youtu.be links. */
export function extractYouTubeRef(text: string | null | undefined): { kind: "handle" | "channel"; value: string } | null {
  if (!text) return null;
  const channel = text.match(/youtube\.com\/channel\/(UC[\w-]{10,})/i);
  if (channel) return { kind: "channel", value: channel[1] };
  const handle = text.match(/youtube\.com\/@([\w.-]{3,30})/i);
  if (handle) return { kind: "handle", value: handle[1] };
  const legacy = text.match(/youtube\.com\/(?:c|user)\/([\w.-]{3,30})/i);
  if (legacy) return { kind: "handle", value: legacy[1] };
  return null;
}

async function api<T>(apiKey: string, path: string, params: Record<string, string>): Promise<T> {
  const search = new URLSearchParams({ ...params, key: apiKey });
  const response = await fetch(`${API}/${path}?${search}`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`YouTube ${path} ${response.status}: ${body.slice(0, 160)}`);
  }
  return (await response.json()) as T;
}

/* Same shape the offer-page extractor uses: price plus trailing period marker. */
const PRICE_PATTERN =
  /[$€£]\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?(?:\s?k\b)?(\s?\/\s?(?:mo|month|yr|year|m|wk|week)\b|\s?per\s+(?:month|year|week)\b)?/gi;

type ChannelsResponse = {
  items?: Array<{
    id: string;
    snippet?: { title?: string; customUrl?: string };
    statistics?: { subscriberCount?: string; videoCount?: string };
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
  }>;
};
type PlaylistResponse = { items?: Array<{ contentDetails?: { videoId?: string } }> };
type VideosResponse = {
  items?: Array<{
    id: string;
    snippet?: { title?: string; description?: string; publishedAt?: string };
    statistics?: { viewCount?: string };
  }>;
};

export async function collectYouTube(args: {
  apiKey: string;
  ref: { kind: "handle" | "channel"; value: string };
}): Promise<YouTubeCollection | null> {
  const { apiKey, ref } = args;

  const channels = await api<ChannelsResponse>(apiKey, "channels", {
    part: "snippet,statistics,contentDetails",
    ...(ref.kind === "channel" ? { id: ref.value } : { forHandle: ref.value }),
  });
  const channel = channels.items?.[0];
  if (!channel) return null;

  const uploads = channel.contentDetails?.relatedPlaylists?.uploads;
  let videoIds: string[] = [];
  if (uploads) {
    const playlist = await api<PlaylistResponse>(apiKey, "playlistItems", {
      part: "contentDetails",
      playlistId: uploads,
      maxResults: "15",
    });
    videoIds = (playlist.items ?? [])
      .map((item) => item.contentDetails?.videoId)
      .filter((id): id is string => Boolean(id));
  }

  const videos: YouTubeCollection["videos"] = [];
  const capturedPrices: YouTubeCollection["capturedPrices"] = [];
  const seenPrices = new Set<string>();

  if (videoIds.length > 0) {
    const details = await api<VideosResponse>(apiKey, "videos", {
      part: "snippet,statistics",
      id: videoIds.join(","),
    });
    for (const video of details.items ?? []) {
      const url = `https://www.youtube.com/watch?v=${video.id}`;
      videos.push({
        title: video.snippet?.title ?? "(untitled)",
        views: video.statistics?.viewCount ? Number(video.statistics.viewCount) : null,
        publishedAt: video.snippet?.publishedAt ?? "",
        url,
      });

      // The whole point: read the descriptions.
      const description = (video.snippet?.description ?? "").replace(/\s+/g, " ");
      for (const match of description.matchAll(PRICE_PATTERN)) {
        const raw = match[0].trim();
        const key = raw.replace(/\s+/g, "").toLowerCase();
        if (seenPrices.has(key)) continue;
        seenPrices.add(key);
        const at = match.index ?? 0;
        capturedPrices.push({
          raw,
          label: null,
          url,
          source: "youtube_description",
          context: description.slice(Math.max(0, at - 50), at + raw.length + 50).trim(),
        });
        if (capturedPrices.length >= 10) break;
      }
    }
  }

  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const handle = channel.snippet?.customUrl?.replace(/^@?/, "") ?? null;

  return {
    channelId: channel.id,
    title: channel.snippet?.title ?? "(unknown channel)",
    handle,
    url: handle ? `https://www.youtube.com/@${handle}` : `https://www.youtube.com/channel/${channel.id}`,
    subscribers: channel.statistics?.subscriberCount ? Number(channel.statistics.subscriberCount) : null,
    videoCount: channel.statistics?.videoCount ? Number(channel.statistics.videoCount) : null,
    uploadsLast30Days: videos.filter((v) => v.publishedAt && new Date(v.publishedAt).getTime() > cutoff).length,
    videos,
    capturedPrices,
  };
}
