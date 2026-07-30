"use server";
import { createClient } from "@/lib/supabase/server";
import { getSettings, resolveHikerApiKey } from "@/lib/config/settings";
import { getHikerApiBalance } from "@/lib/hikerapi/client";

export type HikerBalanceResponse = {
  ok: boolean;
  message: string;
  amount?: number;
  currency?: string;
};

// /sys/balance is free to call (doesn't 402 even at $0), so this is safe to
// hit on demand from the Settings UI without spending anything.
export async function checkHikerApiBalance(): Promise<HikerBalanceResponse> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, message: "unauthorized" };

  const settings = await getSettings(true);
  const apiKey = resolveHikerApiKey(settings);
  if (!apiKey) {
    return { ok: false, message: "No HikerAPI key configured in Settings or env." };
  }

  try {
    const { amount, currency } = await getHikerApiBalance(apiKey);
    return {
      ok: true,
      message: `Balance: ${amount.toFixed(2)} ${currency}`,
      amount,
      currency,
    };
  } catch (err) {
    return { ok: false, message: `Failed to check balance: ${(err as Error).message}` };
  }
}
