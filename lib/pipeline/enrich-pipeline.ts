import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/config/settings";
import { findLinkedInUrl } from "@/lib/linkedin/find";
import { deriveInputs, findEmail, findEmailByLinkedInUrl } from "@/lib/airscale/enrich";

export type EnrichPipelineResult = {
  ok: boolean;
  linkedin_url: string | null;
  email: string | null;
  email_status: string;
  source: "cached" | "linkedin" | "domain" | "skipped";
  error: string | null;
};

export async function enrichLeadPipeline(opts: {
  leadId: string;
  force?: boolean;
}): Promise<EnrichPipelineResult> {
  const sb = createAdminClient();
  const { data: lead } = await sb
    .from("leads")
    .select("id, full_name, external_link, email, email_status, linkedin_url, niche, bio")
    .eq("id", opts.leadId)
    .single();
  if (!lead) {
    return { ok: false, linkedin_url: null, email: null, email_status: "error", source: "skipped", error: "lead_not_found" };
  }

  // Cost-skip: already has a confirmed email, do nothing unless force=true.
  if (!opts.force && lead.email && lead.email_status && /^(valid|found)$/i.test(lead.email_status as string)) {
    return {
      ok: true,
      linkedin_url: (lead.linkedin_url as string | null) ?? null,
      email: lead.email as string,
      email_status: lead.email_status as string,
      source: "cached",
      error: null,
    };
  }

  const settings = await getSettings();
  const airscaleKey = settings.airscale_api_key || process.env.AIRSCALE_API_KEY || "";
  if (!airscaleKey) {
    return persistAndReturn({
      leadId: opts.leadId,
      patch: { enrichment_error: "AirScale API key not configured" },
      result: { ok: false, linkedin_url: null, email: null, email_status: "error", source: "skipped", error: "AirScale API key not configured" },
    });
  }

  const fullName = (lead.full_name as string | null) ?? null;
  const tokens = fullName?.trim().split(/\s+/).filter(Boolean) ?? [];

  let linkedinUrl: string | null = (lead.linkedin_url as string | null) ?? null;
  let linkedinError: string | null = null;

  // Cost-skip: only run SERP if we don't already have a LinkedIn URL.
  if (!linkedinUrl && tokens.length >= 2 && fullName) {
    const sbKey = settings.scrapingbee_api_key || process.env.SCRAPINGBEE_API_KEY || "";
    if (sbKey) {
      const hint = buildHint(lead.niche as string | null, lead.bio as string | null);
      const lookup = await findLinkedInUrl({ apiKey: sbKey, fullName, hints: hint });
      linkedinUrl = lookup.url;
      linkedinError = lookup.error;
    } else {
      linkedinError = "skipped:no_scrapingbee_key";
    }
  }

  // 1. Try AirScale via LinkedIn URL if we have one
  if (linkedinUrl) {
    const first = tokens[0] ?? null;
    const last = tokens.length >= 2 ? tokens[tokens.length - 1] : null;
    const result = await findEmailByLinkedInUrl({
      apiKey: airscaleKey,
      linkedinUrl,
      firstName: first,
      lastName: last,
      leadId: opts.leadId,
    });
    if (result.email) {
      return persistAndReturn({
        leadId: opts.leadId,
        patch: {
          linkedin_url: linkedinUrl,
          linkedin_lookup_error: null,
          email: result.email,
          email_status: result.email_status,
          email_provider: result.email_provider,
          email_verifier: result.email_verifier,
          enriched_at: new Date().toISOString(),
          enrichment_error: null,
        },
        result: { ok: true, linkedin_url: linkedinUrl, email: result.email, email_status: result.email_status, source: "linkedin", error: null },
      });
    }
    // LinkedIn AirScale call returned no email — fall through to domain fallback.
    linkedinError = linkedinError ?? `airscale_linkedin:${result.email_status}`;
  }

  // 2. Fallback: classic name + IG external_link domain
  const inputs = deriveInputs({ full_name: fullName, external_link: lead.external_link as string | null });
  const fallback = await findEmail({ apiKey: airscaleKey, inputs, leadId: opts.leadId });

  return persistAndReturn({
    leadId: opts.leadId,
    patch: {
      linkedin_url: linkedinUrl,
      linkedin_lookup_error: linkedinError,
      email: fallback.email,
      email_status: fallback.email_status,
      email_provider: fallback.email_provider,
      email_verifier: fallback.email_verifier,
      enriched_at: new Date().toISOString(),
      enrichment_error: fallback.error,
    },
    result: {
      ok: !fallback.error,
      linkedin_url: linkedinUrl,
      email: fallback.email,
      email_status: fallback.email_status,
      source: linkedinUrl ? "linkedin" : "domain",
      error: fallback.error,
    },
  });
}

function buildHint(niche: string | null, bio: string | null): string {
  const fromNiche = (niche ?? "").trim();
  if (fromNiche.length >= 4) return fromNiche.slice(0, 60);
  const fromBio = (bio ?? "")
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]{4,}$/.test(w))
    .slice(0, 4)
    .join(" ");
  return fromBio;
}

async function persistAndReturn(opts: {
  leadId: string;
  patch: Record<string, unknown>;
  result: EnrichPipelineResult;
}): Promise<EnrichPipelineResult> {
  const sb = createAdminClient();
  await sb.from("leads").update(opts.patch).eq("id", opts.leadId);
  return opts.result;
}
