import "server-only";
import type { FunnelPlatform } from "@/lib/types";

const HOST_MAP: { match: (host: string) => boolean; platform: FunnelPlatform; isAggregator?: boolean }[] = [
  { match: (h) => h === "linktr.ee" || h.endsWith(".linktree.com"), platform: "linktree", isAggregator: true },
  { match: (h) => h === "stan.store" || h.endsWith(".stan.store"), platform: "stan", isAggregator: true },
  { match: (h) => h === "beacons.ai" || h === "beacons.page" || h.endsWith(".beacons.ai"), platform: "beacons", isAggregator: true },
  /*
   * Skool, Whop, Circle and Gumroad were all missing, and Skool matters most —
   * it is where a large share of these prospects actually sell, and its community
   * pages state a price plainly. Without it those URLs fell through to "custom"
   * and the price extractor had no platform hint to work with.
   *
   * None are aggregators: each URL is a single offer, not a list of links.
   */
  { match: (h) => h === "skool.com" || h.endsWith(".skool.com"), platform: "skool" },
  { match: (h) => h === "whop.com" || h.endsWith(".whop.com"), platform: "whop" },
  { match: (h) => h === "circle.so" || h.endsWith(".circle.so"), platform: "circle" },
  { match: (h) => h === "gumroad.com" || h.endsWith(".gumroad.com"), platform: "gumroad" },
  { match: (h) => h.endsWith(".myclickfunnels.com") || h.endsWith(".clickfunnels.com"), platform: "clickfunnels" },
  { match: (h) => h.endsWith(".mykajabi.com") || h.endsWith(".kajabi.com"), platform: "kajabi" },
  { match: (h) => h.endsWith(".systeme.io") || h === "systeme.io", platform: "systeme" },
  { match: (h) => h.endsWith(".gohighlevel.com") || h.endsWith(".funnelpages.com") || h.endsWith(".msgsndr.com"), platform: "gohighlevel" },
  { match: (h) => h.endsWith(".myshopify.com") || h.endsWith(".shopify.com"), platform: "shopify" },
  { match: (h) => h.endsWith(".thrivecart.com"), platform: "thrivecart" },
  { match: (h) => h === "podia.com" || h.endsWith(".podia.com"), platform: "podia" },
  { match: (h) => h.endsWith(".teachable.com"), platform: "teachable" },
  { match: (h) => h.endsWith(".thinkific.com"), platform: "thinkific" },
  { match: (h) => h.endsWith(".wixsite.com") || h.endsWith(".wix.com"), platform: "wix" },
  { match: (h) => h.endsWith(".squarespace.com"), platform: "squarespace" },
];

const HTML_FINGERPRINTS: { test: RegExp; platform: FunnelPlatform }[] = [
  { test: /clickfunnels|cf-page|funnelhub/i, platform: "clickfunnels" },
  { test: /kajabi-cdn|kajabi\.com\/assets/i, platform: "kajabi" },
  { test: /systeme\.io|systemeio/i, platform: "systeme" },
  { test: /highlevel|leadconnector|msgsndr|funnelpages/i, platform: "gohighlevel" },
  { test: /cdn\.shopify\.com|Shopify\.theme/i, platform: "shopify" },
  { test: /thrivecart/i, platform: "thrivecart" },
  { test: /podia\.com/i, platform: "podia" },
  { test: /teachable\.com/i, platform: "teachable" },
  { test: /thinkific\.com/i, platform: "thinkific" },
  { test: /wp-content|wordpress/i, platform: "wordpress" },
  { test: /wixstatic|wix\.com|_wixCIDX/i, platform: "wix" },
  { test: /squarespace|sqsp\.cdn/i, platform: "squarespace" },
  // Fingerprints for the four added above, for the case where a custom domain
  // fronts the platform and the hostname gives nothing away.
  { test: /skool\.com|__SKOOL/i, platform: "skool" },
  { test: /whop\.com|whop-assets/i, platform: "whop" },
  { test: /circle\.so|circleassets/i, platform: "circle" },
  { test: /gumroad\.com|gumroad-assets/i, platform: "gumroad" },
];

const AGGREGATORS = new Set<FunnelPlatform>(["linktree", "stan", "beacons"]);

export type ClassifyResult = {
  platform: FunnelPlatform;
  isAggregator: boolean;
  host: string | null;
};

export function classifyFunnel(opts: { url: string; html: string }): ClassifyResult {
  const host = parseHost(opts.url);

  if (host) {
    for (const rule of HOST_MAP) {
      if (rule.match(host)) {
        return {
          platform: rule.platform,
          isAggregator: !!rule.isAggregator,
          host,
        };
      }
    }
  }

  const htmlSnippet = opts.html.slice(0, 60_000);
  for (const fp of HTML_FINGERPRINTS) {
    if (fp.test.test(htmlSnippet)) {
      return { platform: fp.platform, isAggregator: AGGREGATORS.has(fp.platform), host };
    }
  }

  return { platform: host ? "custom" : "unknown", isAggregator: false, host };
}

function parseHost(raw: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
