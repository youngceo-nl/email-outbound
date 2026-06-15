import "server-only";
import { getSettings } from "@/lib/config/settings";
import { fetchApifyUsage } from "./apify";
import { fetchScrapingBeeUsage } from "./scrapingbee";
import { buildOpenAiStatus } from "./openai";
import { buildClaudeStatus } from "./claude";
import type { ProviderStatus } from "./types";

let cached: { value: ProviderStatus[]; at: number } | null = null;
const CACHE_MS = 60_000;

export async function fetchAllUsage(opts: { force?: boolean } = {}): Promise<ProviderStatus[]> {
  if (!opts.force && cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const settings = await getSettings();

  const apifyKey = settings.apify_api_key || process.env.APIFY_TOKEN || "";
  const sbKey = settings.scrapingbee_api_key || process.env.SCRAPINGBEE_API_KEY || "";
  const openaiKey = settings.openai_api_key || process.env.OPENAI_API_KEY || "";
  const claudeKey = settings.claude_api_key || process.env.ANTHROPIC_API_KEY || "";

  const [apify, sb] = await Promise.all([
    fetchApifyUsage(apifyKey),
    fetchScrapingBeeUsage(sbKey),
  ]);

  const result: ProviderStatus[] = [
    apify,
    sb,
    buildOpenAiStatus(openaiKey, settings.openai_model),
    buildClaudeStatus(claudeKey, settings.claude_model),
  ];

  cached = { value: result, at: Date.now() };
  return result;
}

export function clearUsageCache() {
  cached = null;
}
