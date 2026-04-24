import type { Lead } from "@/lib/types";

// Tiny mustache-lite substitution. `{{name}}` and `{{name|default}}` are both
// supported; `{{name}}` falls back to "" if missing. We intentionally do NOT
// support nested paths or logic — outreach copy stays human-editable.
export type TemplateContext = Record<string, string | number | null | undefined>;

const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)(?:\s*\|\s*([^}]*?))?\s*\}\}/g;

export function renderTemplate(tpl: string, ctx: TemplateContext): string {
  return tpl.replace(TOKEN, (_match, key: string, fallback?: string) => {
    const v = ctx[key];
    if (v == null || v === "") return (fallback ?? "").trim();
    return String(v);
  });
}

export function buildLeadContext(opts: {
  lead: Pick<
    Lead,
    | "username"
    | "full_name"
    | "niche"
    | "business_model"
    | "funnel_program_name"
    | "funnel_offer_summary"
    | "external_link"
  >;
  senderName: string | null;
}): TemplateContext {
  const full = (opts.lead.full_name ?? "").trim();
  const firstName = full ? full.split(/\s+/)[0] : opts.lead.username;
  return {
    first_name: firstName,
    full_name: full || opts.lead.username,
    username: opts.lead.username,
    niche: opts.lead.niche ?? "",
    business_model: opts.lead.business_model ?? "",
    program_name: opts.lead.funnel_program_name ?? "",
    offer_summary: opts.lead.funnel_offer_summary ?? "",
    external_link: opts.lead.external_link ?? "",
    sender_name: opts.senderName ?? "",
  };
}

export function textToHtml(text: string): string {
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}
