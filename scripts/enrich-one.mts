// One-off: run the email-enrichment pipeline for a single lead by IG username.
//
//   npx tsx --conditions react-server scripts/enrich-one.ts <username>
//
// Loads .env.local, looks up the lead, runs the (post-AirScale) pipeline, and
// prints the result + the lead's email fields. Read-only except for the
// pipeline's own writes to the lead row.

import { readFileSync } from "node:fs";

// Load .env.local into process.env BEFORE importing anything that reads env.
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  /* no .env.local — rely on ambient env */
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { enrichLeadPipeline } = await import("../lib/pipeline/enrich-pipeline");

  const raw = process.argv[2] ?? "";
  const username = raw.replace(/^@/, "").trim();
  if (!username) {
    console.error("usage: npx tsx --conditions react-server scripts/enrich-one.ts <username>");
    process.exit(2);
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: lead, error } = await sb
    .from("leads")
    .select("id, username, full_name, external_link, funnel_url, bio, email, email_status, email_provider, youtube_url, enrichment_error")
    .eq("username", username)
    .maybeSingle();

  if (error) {
    console.error("DB error:", error.message);
    process.exit(1);
  }
  if (!lead) {
    console.error(`Lead @${username} is NOT in the leads table — nothing to enrich.`);
    process.exit(3);
  }

  console.error("── lead BEFORE ──");
  console.error(JSON.stringify({
    username: lead.username,
    full_name: lead.full_name,
    external_link: lead.external_link,
    bio: lead.bio?.slice(0, 120),
    email: lead.email,
    email_status: lead.email_status,
    email_provider: lead.email_provider,
    youtube_url: lead.youtube_url,
    enrichment_error: lead.enrichment_error,
  }, null, 2));

  console.error("\n── running enrichLeadPipeline(force) ──");
  const t0 = process.hrtime.bigint();
  const result = await enrichLeadPipeline({ leadId: lead.id as string, force: true });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;

  console.error(`\n── result (took ${ms.toFixed(0)} ms) ──`);
  console.log(JSON.stringify(result, null, 2));
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
