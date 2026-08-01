import { writeFileSync } from "node:fs";
import { createAdminClient } from "@/lib/supabase/admin";

const supabase = createAdminClient();

// Spec's own reprocessing cohort order (Chapter 8), minus private_account
// (mostly legitimate — private with no public evidence is a real exclusion).
const PATTERNS = [
  "no_recent_posts",
  "engagement_below_min",
  "reels_30d_below_min%",
  "no_include_keyword_match",
  "followers_below_min%",
  "followers_above_max%",
];

const PER_CATEGORY_LIMIT = 100; // 6 categories * 100 = up to 600 candidates for this batch

const seen = new Set<string>();
const rows: { username: string; rejection_reason: string }[] = [];

for (const pattern of PATTERNS) {
  const { data, error } = await supabase
    .from("leads")
    .select("username, rejection_reason")
    .eq("status", "rejected")
    .ilike("rejection_reason", pattern.includes("%") ? pattern : `${pattern}%`)
    .order("id")
    .limit(PER_CATEGORY_LIMIT);
  if (error) {
    console.error(pattern, error.message);
    continue;
  }
  let added = 0;
  for (const row of data ?? []) {
    if (seen.has(row.username)) continue;
    seen.add(row.username);
    rows.push({ username: row.username, rejection_reason: row.rejection_reason ?? "" });
    added++;
  }
  console.log(pattern.padEnd(30), `fetched ${data?.length ?? 0}, added ${added}`);
}

console.log("\ntotal unique candidates:", rows.length);
writeFileSync("output/qualification/recovery-batch-1.txt", rows.map((r) => r.username).join("\n") + "\n");
writeFileSync("output/qualification/recovery-batch-1.meta.json", JSON.stringify(rows, null, 2));
console.log("written to output/qualification/recovery-batch-1.txt");
