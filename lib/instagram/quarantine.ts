import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, gmailReady } from "@/lib/outreach/gmail";
import { logError } from "@/lib/pipeline/persist";
import type { AppSettings } from "@/lib/types";
import { pauseManagedAccount, sanitizeProxyEndpoint } from "./quarantine-policy";

export type QuarantineIncident = {
  accountUsername: string;
  leadUsername: string;
  proxyUrl: string;
  steelProfileId: string | null;
  sessionId: string | null;
  challenge: string;
  crawlJobId?: string | null;
};

export async function quarantineAccount(incident: QuarantineIncident): Promise<void> {
  const sb = createAdminClient();
  let latest: AppSettings | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await sb.from("app_settings").select("*").eq("id", 1).single();
    if (error || !data) throw new Error(error?.message ?? "settings row missing");
    latest = data as AppSettings;
    const accounts = pauseManagedAccount(
      latest.instagram_accounts ?? [],
      incident.accountUsername,
      incident.challenge,
    );
    const { data: written, error: writeError } = await sb
      .from("app_settings")
      .update({ instagram_accounts: accounts })
      .eq("id", 1)
      .eq("updated_at", latest.updated_at)
      .select("id")
      .maybeSingle();
    if (writeError) throw new Error(writeError.message);
    if (written) break;
    latest = null;
  }
  if (!latest) throw new Error("Could not quarantine account because shared settings changed concurrently");

  const safePayload = {
    account: incident.accountUsername,
    lead: incident.leadUsername,
    proxy: sanitizeProxyEndpoint(incident.proxyUrl),
    steel_profile_id: incident.steelProfileId,
    steel_session_id: incident.sessionId,
    challenge: incident.challenge,
  };
  await logError({
    context: "instagram-account-quarantined",
    error_message: `Paused @${incident.accountUsername} after ${incident.challenge}`,
    payload: safePayload,
    crawl_job_id: incident.crawlJobId ?? null,
  });

  const recipient = latest.gmail_oauth_email || process.env.GMAIL_USER || "";
  try {
    if (!recipient || !(await gmailReady())) return;
    await sendEmail({
      to: recipient,
      subject: `Instagram account quarantined: ${incident.accountUsername}`,
      text: [
        `Account: @${incident.accountUsername}`,
        `Lead: @${incident.leadUsername}`,
        `Proxy: ${safePayload.proxy}`,
        `Steel profile: ${incident.steelProfileId ?? "none"}`,
        `Steel session: ${incident.sessionId ?? "unknown"}`,
        `Challenge: ${incident.challenge}`,
        "The account is paused. Do not retry it through another proxy.",
      ].join("\n"),
    });
  } catch (error) {
    await logError({
      context: "instagram-quarantine-alert",
      error_message: error instanceof Error ? error.message : String(error),
      payload: safePayload,
      crawl_job_id: incident.crawlJobId ?? null,
    }).catch(() => {});
  }
}
