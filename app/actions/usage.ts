"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { clearUsageCache } from "@/lib/usage/aggregate";

export async function refreshUsage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: "unauthorized" };
  clearUsageCache();
  revalidatePath("/usage");
  return { ok: true };
}
