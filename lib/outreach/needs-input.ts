import {
  buildLeadContext,
  extractTemplateKeys,
  extractFirstName,
  extractFirstNameFromUsername,
  cleanProgramName,
} from "@/lib/outreach/template";

export type NeedsInputResult = { needsInput: boolean; missingKeys: string[] };

type LeadForTemplate = Parameters<typeof buildLeadContext>[0]["lead"];

// Dynamic, per-(step, lead) check — deliberately not a static per-step flag.
// For every placeholder actually used in *this* step's subject+body, ask
// whether it resolved to something real for *this* lead, not to one of
// buildLeadContext's silent generic fallbacks ("there" for first_name, "your
// X coaching program" for program_name — renderTemplate never produces an
// empty string for these, so a plain emptiness check on the rendered output
// would miss them). Every other context key has no hidden fallback, so a
// plain empty-string check is correct there and for any future template
// field added later — that's what makes this generalize without a schema
// change, per docs/instantly-fying-outreachpage/leadpipelinetocampaign.md's
// "when a followup email needs input... enrichment of a variable property".
export function detectStepNeedsInput(opts: {
  subjectTemplate: string;
  bodyTemplate: string;
  lead: LeadForTemplate;
  senderName: string | null;
}): NeedsInputResult {
  const ctx = buildLeadContext({ lead: opts.lead, senderName: opts.senderName });
  const usedKeys = new Set([
    ...extractTemplateKeys(opts.subjectTemplate, ctx),
    ...extractTemplateKeys(opts.bodyTemplate, ctx),
  ]);

  const missing: string[] = [];
  for (const key of usedKeys) {
    if (key === "first_name" || key === "name") {
      const real = extractFirstName(opts.lead.full_name) ?? extractFirstNameFromUsername(opts.lead.username);
      if (real === null) missing.push(key);
      continue;
    }
    if (key === "program_name") {
      if (!cleanProgramName(opts.lead.funnel_program_name)) missing.push(key);
      continue;
    }
    const v = ctx[key];
    if (v == null || v === "") missing.push(key);
  }

  return { needsInput: missing.length > 0, missingKeys: missing };
}
