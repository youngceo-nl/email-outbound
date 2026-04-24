"use server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { clearUsageCache } from "@/lib/usage/aggregate";

export async function refreshBilling() {
  clearUsageCache();
  revalidatePath("/billing");
}

export async function upsertFixedCost(input: {
  id?: string;
  label: string;
  monthlyUsd: number;
  note?: string | null;
}) {
  const sb = createAdminClient();
  const label = input.label.trim();
  if (!label) throw new Error("Label is required");
  const monthly_usd = Number.isFinite(input.monthlyUsd) ? Math.max(0, input.monthlyUsd) : 0;

  if (input.id) {
    const { error } = await sb
      .from("fixed_costs")
      .update({ label, monthly_usd, note: input.note ?? null })
      .eq("id", input.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await sb
      .from("fixed_costs")
      .insert({ label, monthly_usd, note: input.note ?? null });
    if (error) throw new Error(error.message);
  }
  revalidatePath("/billing");
}

export async function setFixedCostActive(id: string, active: boolean) {
  const sb = createAdminClient();
  const { error } = await sb.from("fixed_costs").update({ active }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/billing");
}

export async function deleteFixedCost(id: string) {
  const sb = createAdminClient();
  const { error } = await sb.from("fixed_costs").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/billing");
}
