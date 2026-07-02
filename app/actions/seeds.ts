"use server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { toUsername, profileUrl } from "@/lib/pipeline/normalize";
import { inngest } from "@/inngest/client";
import { getSettings } from "@/lib/config/settings";
import { serperSearch } from "@/lib/serper/client";
import { scrapeSkoolCommunity } from "@/lib/platforms/skool";
import { scrapeWhopSeller } from "@/lib/platforms/whop";

async function requireUser() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("unauthorized");
}

function parseLimit(v: FormDataEntryValue | null): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

// Reserved Instagram path segments that are NOT profile usernames
const IG_RESERVED = new Set([
  "p", "reel", "reels", "tv", "stories", "explore", "accounts",
  "about", "help", "legal", "privacy", "safety", "press", "direct",
  "directory", "login", "challenge", "oauth", "api",
]);
const IG_PROFILE_RE = /^https?:\/\/(www\.)?instagram\.com\/([a-zA-Z0-9_.]{1,30})\/?(\?.*)?$/;

export type DiscoveredSeedResult = {
  username: string;
  snippet: string | null;
  title: string | null;
};

export async function discoverSeeds(opts: { keywords: string }): Promise<
  { results: DiscoveredSeedResult[] } | { error: string }
> {
  await requireUser();
  const settings = await getSettings(true);
  const apiKey = settings.serper_api_key || process.env.SERPER_API_KEY;
  if (!apiKey) return { error: "Serper API key not configured — add it in Settings." };

  const kwParts = opts.keywords
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => `"${k}"`);
  if (kwParts.length === 0) return { error: "Enter at least one keyword." };

  // Two complementary queries: one broad, one bio-focused
  const base = `site:instagram.com ${kwParts.join(" OR ")}`;
  const [r1, r2] = await Promise.all([
    serperSearch({ apiKey, query: base, num: 20 }),
    serperSearch({ apiKey, query: `${base} bio`, num: 10 }),
  ]);

  const seen = new Set<string>();
  const results: DiscoveredSeedResult[] = [];

  for (const r of [...r1.organic, ...r2.organic]) {
    if (!r.link) continue;
    const m = r.link.match(IG_PROFILE_RE);
    if (!m) continue;
    const username = m[2].toLowerCase();
    if (IG_RESERVED.has(username)) continue;
    if (seen.has(username)) continue;
    seen.add(username);
    results.push({ username, snippet: r.snippet ?? null, title: r.title ?? null });
  }

  return { results };
}

export async function addSeed(formData: FormData) {
  await requireUser();
  const raw = String(formData.get("input") ?? "").trim();
  if (!raw) return { error: "Empty input" };
  const username = toUsername(raw);
  if (!username) return { error: "Invalid username/URL" };
  const max_profiles_to_scrape = parseLimit(formData.get("max_profiles_to_scrape"));

  const sb = createAdminClient();
  const { error } = await sb.from("seeds").insert({
    username,
    profile_url: profileUrl(username),
    max_profiles_to_scrape,
  });

  if (error) {
    if (!error.message.includes("duplicate")) return { error: error.message };
    // Already exists — bump created_at so it sorts to the top.
    await sb.from("seeds").update({ created_at: new Date().toISOString() }).eq("username", username);
    revalidatePath("/seeds");
    return { ok: true, already_existed: true };
  }

  revalidatePath("/seeds");
  return { ok: true };
}

export async function updateSeedLimit(id: string, max_profiles_to_scrape: number | null) {
  await requireUser();
  const value =
    max_profiles_to_scrape != null && Number.isFinite(max_profiles_to_scrape) && max_profiles_to_scrape > 0
      ? Math.floor(max_profiles_to_scrape)
      : null;
  const sb = createAdminClient();
  const { error } = await sb.from("seeds").update({ max_profiles_to_scrape: value }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/seeds");
  return { ok: true };
}

export async function deleteSeed(id: string) {
  await requireUser();
  const sb = createAdminClient();
  await sb.from("seeds").delete().eq("id", id);
  revalidatePath("/seeds");
}

export type ScrapeProvider = "auto" | "playwright" | "cookie" | "apify" | "scrapingbee";

export async function addSeedsBulk(usernames: string[]): Promise<{ added: number; skipped: number; error?: string }> {
  await requireUser();
  const sb = createAdminClient();
  let added = 0;
  let skipped = 0;
  for (const raw of usernames) {
    const username = toUsername(raw.trim());
    if (!username) { skipped++; continue; }
    const { error } = await sb.from("seeds").insert({ username, profile_url: profileUrl(username) });
    if (error) { skipped++; continue; }
    added++;
  }
  revalidatePath("/seeds");
  return { added, skipped };
}

export async function startAllCrawls(providerOverride?: ScrapeProvider): Promise<{ started: number; error?: string }> {
  await requireUser();
  const admin = createAdminClient();
  const settings = await getSettings(true);

  const { data: seeds } = await admin.from("seeds").select("id, username, max_profiles_to_scrape");
  if (!seeds?.length) return { started: 0 };

  // Skip seeds that already have a running or queued job
  const { data: activeJobs } = await admin
    .from("crawl_jobs")
    .select("seed_id")
    .in("status", ["running", "queued"]);
  const activeSeedIds = new Set((activeJobs ?? []).map((j) => j.seed_id));

  const provider = providerOverride ?? settings.following_scraper_provider;
  let started = 0;

  for (const seed of seeds) {
    if (activeSeedIds.has(seed.id)) continue;
    const { data: job, error: jobErr } = await admin
      .from("crawl_jobs")
      .insert({ seed_id: seed.id, status: "queued", max_depth: 1 })
      .select("id")
      .single();
    if (jobErr || !job) continue;
    const { ids } = await inngest.send({
      name: "crawl/seed.requested",
      data: {
        crawl_job_id: job.id,
        seed_id: seed.id,
        seed_username: seed.username,
        profile_limit: seed.max_profiles_to_scrape ?? null,
        provider_override: providerOverride ?? null,
      },
    });
    await admin.from("crawl_jobs").update({ inngest_run_id: ids[0] ?? null }).eq("id", job.id);
    started++;
  }

  revalidatePath("/seeds");
  revalidatePath("/");
  return { started };
}

// Owner name patterns seen in Skool / Whop / ClickBank descriptions
const OWNER_PATTERNS = [
  /created by\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?)/i,
  /\bby\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){0,2})\b/,
  /from\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?)/i,
  /with\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?)\b/i,
  /w\/\s*([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?)/i,
];

function extractOwnerName(description: string): string | null {
  for (const re of OWNER_PATTERNS) {
    const m = description.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

export type PlatformSeedResult = {
  communityName: string;
  platform: string;
  username: string;
  snippet: string | null;
  title: string | null;
  source: "page" | "serper";
};

export type PlatformCommunity = {
  name: string;
  // Skool: community slug (e.g. "agencyowners")
  // Whop: seller slug or full URL (e.g. "some-product" or "https://whop.com/...")
  slug?: string;
  description?: string;
  platform?: "Skool" | "Whop";
};

async function serperFallback(
  searchTerm: string,
  communityName: string,
  platform: string,
  apiKey: string,
  seen: Set<string>,
): Promise<PlatformSeedResult | null> {
  const query = `"${searchTerm}" site:instagram.com`;
  try {
    const r = await serperSearch({ apiKey, query, num: 5 });
    for (const item of r.organic) {
      if (!item.link) continue;
      const m = item.link.match(IG_PROFILE_RE);
      if (!m) continue;
      const username = m[2].toLowerCase();
      if (IG_RESERVED.has(username) || seen.has(username)) continue;
      seen.add(username);
      return { communityName, platform, username, snippet: item.snippet ?? null, title: item.title ?? null, source: "serper" };
    }
  } catch {}
  return null;
}

export async function discoverSeedsFromCommunities(
  communities: PlatformCommunity[]
): Promise<{ results: PlatformSeedResult[] } | { error: string }> {
  await requireUser();
  if (communities.length === 0) return { error: "No communities provided." };
  if (communities.length > 25) return { error: "Max 25 communities at once." };

  const settings = await getSettings(true);
  const serperKey = settings.serper_api_key || process.env.SERPER_API_KEY;

  const seen = new Set<string>();
  const results: PlatformSeedResult[] = [];

  for (const community of communities) {
    const platform = community.platform ?? "Skool";
    let foundUsername: string | null = null;
    let ownerName: string | null = community.description ? extractOwnerName(community.description) : null;

    // --- Step 1: try direct page scrape (free) ---
    if (platform === "Skool" && community.slug) {
      const scraped = await scrapeSkoolCommunity(community.slug);
      if ("error" in scraped === false) {
        foundUsername = scraped.instagram;
        if (scraped.ownerName) ownerName = scraped.ownerName;
      }
    } else if (platform === "Whop" && community.slug) {
      const scraped = await scrapeWhopSeller(community.slug);
      if ("error" in scraped === false) {
        foundUsername = scraped.instagram;
        if (!("error" in scraped) && scraped.sellerName) ownerName = scraped.sellerName;
      }
    }

    if (foundUsername && !seen.has(foundUsername)) {
      seen.add(foundUsername);
      results.push({ communityName: community.name, platform, username: foundUsername, snippet: null, title: ownerName, source: "page" });
      continue;
    }

    // --- Step 2: Serper fallback (costs a credit) ---
    if (!serperKey) continue;
    const searchTerm = ownerName ?? community.name;
    const result = await serperFallback(searchTerm, community.name, platform, serperKey, seen);
    if (result) results.push(result);
  }

  return { results };
}

export async function startCrawl(seed_id: string, providerOverride?: ScrapeProvider) {
  await requireUser();
  const admin = createAdminClient();
  const { data: seed } = await admin
    .from("seeds")
    .select("id, username, max_profiles_to_scrape")
    .eq("id", seed_id)
    .single();
  if (!seed) return { error: "seed_not_found" };

  const settings = await getSettings(true);
  const provider = providerOverride ?? settings.following_scraper_provider;

  const apifyOk = !!(settings.apify_api_key || process.env.APIFY_TOKEN);
  const sbOk = !!(settings.scrapingbee_api_key || process.env.SCRAPINGBEE_API_KEY);
  const cookieOk = !!(
    (settings.instagram_session_cookies ?? []).length > 0 ||
    settings.instagram_session_cookie ||
    process.env.INSTAGRAM_SESSION_COOKIE
  );

  if (provider === "apify" && !apifyOk)
    return { error: "Apify selected but no Apify API key is set." };
  if (provider === "scrapingbee" && !(sbOk && cookieOk))
    return { error: "ScrapingBee selected but missing API key or Instagram cookie." };
  if (provider === "cookie" && !cookieOk)
    return { error: "Cookie/proxy selected but no Instagram session cookie configured." };
  if (provider === "auto" && !apifyOk && !cookieOk)
    return { error: "No scrape provider configured. Add an Apify key or Instagram cookie in Settings." };

  const scoring = settings.scoring_provider;
  if (scoring === "claude" && !(settings.claude_api_key || process.env.ANTHROPIC_API_KEY))
    return { error: "Claude scoring selected but no Anthropic API key set." };
  if (scoring === "openai" && !(settings.openai_api_key || process.env.OPENAI_API_KEY))
    return { error: "OpenAI scoring selected but no OpenAI API key set." };
  if (scoring === "gemini" && !(settings.gemini_api_key || process.env.GEMINI_API_KEY))
    return { error: "Gemini scoring selected but no Gemini API key set." };
  if (scoring === "groq" && !(settings.groq_api_key || process.env.GROQ_API_KEY))
    return { error: "Groq scoring selected but no Groq API key set." };

  const { data: job, error: jobErr } = await admin
    .from("crawl_jobs")
    .insert({ seed_id: seed.id, status: "queued", max_depth: 1 })
    .select("id")
    .single();
  if (jobErr || !job) return { error: jobErr?.message ?? "job_create_failed" };

  const { ids } = await inngest.send({
    name: "crawl/seed.requested",
    data: {
      crawl_job_id: job.id,
      seed_id: seed.id,
      seed_username: seed.username,
      profile_limit: seed.max_profiles_to_scrape ?? null,
      provider_override: providerOverride ?? null,
    },
  });
  await admin.from("crawl_jobs").update({ inngest_run_id: ids[0] ?? null }).eq("id", job.id);

  revalidatePath("/seeds");
  revalidatePath("/");
  return { ok: true, crawl_job_id: job.id, profile_limit: seed.max_profiles_to_scrape ?? settings.max_profiles_per_account ?? 100, seed_username: seed.username };
}

export type SkoolCsvRow = { slug: string; name: string; members: number | null; price: string | null };
export type SkoolImportResponse = { ok: boolean; queued: number; crawl_job_id?: string; error?: string };

// Batch-imports Skool communities parsed from a CSV export: creates a
// crawl_job (so progress can be tracked the same way as any other bulk op)
// and fires one skool/community.discovered event per row. The Inngest
// function does the actual Skool-page scrape + Instagram scrape + score.
export async function importSkoolCsv(rows: SkoolCsvRow[]): Promise<SkoolImportResponse> {
  await requireUser();
  if (!rows.length) return { ok: false, queued: 0, error: "No rows to import." };

  const admin = createAdminClient();
  const { data: job, error: jobErr } = await admin
    .from("crawl_jobs")
    .insert({
      seed_id: null,
      status: "running",
      max_depth: 0,
      current_depth: 0,
      expected_profiles: rows.length,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (jobErr || !job) return { ok: false, queued: 0, error: jobErr?.message ?? "could not create crawl_job" };

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await inngest.send(
      rows.slice(i, i + CHUNK).map((r) => ({
        name: "skool/community.discovered" as const,
        data: { crawl_job_id: job.id, slug: r.slug, name: r.name },
      })),
    );
  }

  revalidatePath("/seeds");
  return { ok: true, queued: rows.length, crawl_job_id: job.id };
}

export type SkoolImportProgress = {
  total: number;
  scraped: number;
  qualified: number;
  rejected: number;
  done: boolean;
};

export async function getSkoolImportProgress(crawlJobId: string): Promise<SkoolImportProgress | null> {
  await requireUser();
  const admin = createAdminClient();
  const { data } = await admin
    .from("crawl_jobs")
    .select("expected_profiles, profiles_scraped, qualified_count, rejected_count")
    .eq("id", crawlJobId)
    .single();
  if (!data) return null;
  const total = data.expected_profiles ?? 0;
  return {
    total,
    scraped: data.profiles_scraped,
    qualified: data.qualified_count,
    rejected: data.rejected_count,
    done: total > 0 && data.profiles_scraped >= total,
  };
}
