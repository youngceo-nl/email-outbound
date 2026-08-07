import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const { createAdminClient } = await import("./lib/supabase/admin");
const sb = createAdminClient();
const JOB = "be61436c-9abc-4967-9004-4a3ba26c47da";
const SEED = "4da8153a-2b76-4ffe-968f-9c8c987fcf83";
const { data: j } = await sb.from("crawl_jobs").select("status, profiles_scraped, new_leads, error_message").eq("id", JOB).single();
const { count } = await sb.from("leads").select("id", { count: "exact", head: true }).eq("source_seed_id", SEED);
console.log(`status=${j?.status} scraped=${j?.profiles_scraped} new=${j?.new_leads} leads=${count} err=${(j?.error_message ?? "none").slice(0,70)}`);
