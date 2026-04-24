import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Returns the subset of `usernames` that are NOT already in the leads table.
export async function filterNewUsernames(usernames: string[]): Promise<string[]> {
  if (usernames.length === 0) return [];
  const sb = createAdminClient();
  const lower = [...new Set(usernames.map((u) => u.toLowerCase()))];

  const { data, error } = await sb.from("leads").select("username").in("username", lower);
  if (error) throw new Error(`dedup query failed: ${error.message}`);

  const existing = new Set((data ?? []).map((r) => r.username));
  return lower.filter((u) => !existing.has(u));
}
