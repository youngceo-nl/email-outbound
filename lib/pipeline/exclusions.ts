import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Returns the set of lowercased usernames (from the given list) that are on the
// permanent exclusion list — leads the user bulk-deleted and never wants back.
export async function getExcludedUsernames(usernames: string[]): Promise<Set<string>> {
  const excluded = new Set<string>();
  if (usernames.length === 0) return excluded;
  const sb = createAdminClient();
  const lower = [...new Set(usernames.map((u) => u.toLowerCase()))];
  const BATCH = 500;
  for (let i = 0; i < lower.length; i += BATCH) {
    const batch = lower.slice(i, i + BATCH);
    const { data, error } = await sb
      .from("excluded_usernames")
      .select("username")
      .in("username", batch);
    if (error) throw new Error(`exclusion query failed: ${error.message}`);
    for (const r of data ?? []) excluded.add(r.username);
  }
  return excluded;
}
