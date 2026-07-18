import "server-only";
import { scrapingBeeGet, ScrapingBeeError } from "@/lib/scrapingbee/client";

export type FunnelFetchResult = {
  url: string;
  finalUrl: string;
  html: string;
  status: number;
};

// TODO: cost telemetry — render_js + premium_proxy is ~10–25 SB credits per call.
export async function fetchFunnelPage(opts: {
  apiKey: string;
  url: string;
  countryCode?: string;
}): Promise<FunnelFetchResult> {
  const url = normalizeUrl(opts.url);
  const { status, body } = await scrapingBeeGet({
    apiKey: opts.apiKey,
    url,
    renderJs: true,
    premiumProxy: true,
    countryCode: opts.countryCode,
    retries: 1,
  });
  return { url, finalUrl: extractFinalUrl(body) ?? url, html: body, status };
}

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new ScrapingBeeError("empty funnel URL");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function extractFinalUrl(html: string): string | null {
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  return m ? m[1] : null;
}
