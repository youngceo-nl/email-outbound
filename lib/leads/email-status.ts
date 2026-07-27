// Pure derivation of a lead's email + enrichment state for display. Shared by
// the lead detail page's Email card and the double-click edit dialog so the two
// never drift. No I/O, no server-only deps — safe to import from client code.
//
// The four states come from two timestamps (see lib/handover/batch.ts):
//   enriched_at            — set only when a Clay hand-back returned an email
//   handover_enriched_at   — set on every completed hand-back, email or not
// An email with neither set was found by the scrape-time waterfall, before the
// lead ever reached Clay.

export type EmailEnrichmentTone = "success" | "attempted" | "auto" | "none";

export type EmailEnrichment = {
  email: string | null;
  provider: string | null;
  status: string | null;
  badStatus: boolean;
  label: string;
  tone: EmailEnrichmentTone;
};

const BAD_EMAIL_STATUS = /^(bounced|invalid)$/i;

type EmailFields = {
  email: string | null;
  email_v2: string | null;
  email_provider: string | null;
  email_v2_provider: string | null;
  email_status: string | null;
  email_v2_status: string | null;
  enriched_at: string | null;
  handover_enriched_at: string | null;
};

export function describeLeadEmail(lead: EmailFields): EmailEnrichment {
  // Same v1→v2 fallback the outreach-ready page uses.
  const email = lead.email ?? lead.email_v2;
  const provider = lead.email ? lead.email_provider : lead.email_v2_provider;
  const status = lead.email ? lead.email_status : lead.email_v2_status;
  const badStatus = BAD_EMAIL_STATUS.test(status ?? "");

  const date = (iso: string) => new Date(iso).toLocaleDateString();

  let label: string;
  let tone: EmailEnrichmentTone;
  if (lead.enriched_at) {
    label = `Enriched via ${provider ?? "Clay"} · ${date(lead.enriched_at)}`;
    tone = "success";
  } else if (lead.handover_enriched_at) {
    label = `Enrichment attempted — no email found · ${date(lead.handover_enriched_at)}`;
    tone = "attempted";
  } else if (email) {
    label = "Found automatically";
    tone = "auto";
  } else {
    label = "Not yet enriched";
    tone = "none";
  }

  return { email, provider, status, badStatus, label, tone };
}

// Badge variant per tone — kept here so both consumers render consistently.
export function enrichmentBadgeVariant(
  tone: EmailEnrichmentTone,
): "default" | "secondary" | "outline" {
  if (tone === "success") return "default";
  if (tone === "attempted") return "secondary";
  return "outline";
}
