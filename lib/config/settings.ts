import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppSettings } from "@/lib/types";

let cached: { value: AppSettings; at: number } | null = null;
const CACHE_MS = 30_000;

export async function getSettings(force = false): Promise<AppSettings> {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const sb = createAdminClient();
  const { data, error } = await sb.from("app_settings").select("*").eq("id", 1).single();
  if (error || !data) throw new Error(`Failed to load app_settings: ${error?.message ?? "no row"}`);
  cached = { value: data as AppSettings, at: Date.now() };
  return cached.value;
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const sb = createAdminClient();
  const { data, error } = await sb
    .from("app_settings")
    .update(patch)
    .eq("id", 1)
    .select("*")
    .single();
  if (error) throw new Error(`Failed to update settings: ${error.message}`);
  cached = { value: data as AppSettings, at: Date.now() };
  return cached.value;
}

// Resolve a key from DB first, env var as fallback.
// Apify is OPTIONAL — required only if `following_scraper_provider` is "apify"
// or "auto" without ScrapingBee configured.
export function resolveApifyToken(s: AppSettings): string | null {
  return s.apify_api_key || process.env.APIFY_TOKEN || null;
}
export function resolveClaudeKey(s: AppSettings): string {
  const k = s.claude_api_key || process.env.ANTHROPIC_API_KEY || "";
  if (!k) throw new Error("ANTHROPIC_API_KEY not configured (set in Settings or env)");
  return k;
}
