// Shared "is this lead's email actually sendable" check — the v1/v2 fallback
// plus bounced/invalid filtering that app/(dashboard)/outreach-ready/page.tsx
// and getCampaignSendQueue (app/actions/campaigns.ts) both need identically.
import { isPlausible } from "@/lib/leads/email-extract";

export const BAD_EMAIL_STATUS = /^(bounced|invalid)$/i;

type EmailFields = {
  email: string | null;
  email_status: string | null;
  email_v2: string | null;
  email_v2_status: string | null;
  email_provider: string | null;
  email_v2_provider: string | null;
};

export function resolveReadyEmail(lead: EmailFields): { email: string; provider: string | null } | null {
  if (BAD_EMAIL_STATUS.test(lead.email_status ?? "")) return null;

  const resolved = lead.email ?? lead.email_v2;
  if (!resolved || !isPlausible(resolved)) return null;
  // Fell back to v2 — apply v2's own status check.
  if (!lead.email && BAD_EMAIL_STATUS.test(lead.email_v2_status ?? "")) return null;

  return { email: resolved, provider: (lead.email ? lead.email_provider : lead.email_v2_provider) ?? null };
}
