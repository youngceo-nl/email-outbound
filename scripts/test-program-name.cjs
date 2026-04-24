// Test extraction of `program_name` from already-scraped lead data.
// Run with: node --env-file=.env.local scripts/test-program-name.cjs
const OpenAI = require("openai").default;
const { createClient } = require("@supabase/supabase-js");

const SYSTEM = `You extract the BRAND or PROGRAM NAME from an Instagram account — the short name a stranger would use to refer to this business or offer.

Rules:
- 1–4 words, proper case, no emojis, no @, no quotes.
- Prefer the branded form of the handle/full_name when the account is a business (DISPATCH DUDES -> "Dispatch Dudes", vvsluxe -> "VVS Luxe").
- For personal brands (coaches, creators, advisors selling under their own name) use their full name ("Harry Gunter", "Patrick Lovelace").
- For ecom shops, use the shop name. For courses/coaching programs with a specific product name (e.g. "TraderBlueprint", "Ad Mastery"), use that.
- If a SPECIFIC program/offer name appears in bio or captions, prefer it over the generic brand.
- Output STRICT JSON only. If genuinely unclear, set confidence to "low".`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["program_name", "confidence"],
  properties: {
    program_name: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
};

async function extract(client, profile) {
  const captions = (profile.recent_posts || [])
    .slice(0, 5)
    .map((p, i) => `${i + 1}. ${(p.caption ?? "").slice(0, 220)}`)
    .join("\n");
  const userPrompt = `Extract the brand/program name.

PROFILE
- username: @${profile.username}
- full_name: ${profile.full_name ?? ""}
- bio: ${profile.bio ?? ""}
- external_link: ${profile.external_link ?? "(none)"}

RECENT CAPTIONS
${captions || "(none)"}`;

  const res = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_schema", json_schema: { name: "program_name_extraction", strict: true, schema: SCHEMA } },
    temperature: 0.2,
    max_tokens: 80,
  });
  return JSON.parse(res.choices[0].message.content);
}

(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const { data: leads } = await sb
    .from("leads")
    .select("username, full_name, bio, external_link, recent_posts, niche, business_model, overall_score")
    .not("overall_score", "is", null)
    .order("overall_score", { ascending: false })
    .limit(15);

  console.log(`Testing on ${leads.length} leads (highest-score first)...\n`);
  for (const lead of leads) {
    try {
      const out = await extract(ai, lead);
      const bioPreview = (lead.bio || "").replace(/\s+/g, " ").slice(0, 70);
      console.log(`@${lead.username.padEnd(22)} full="${(lead.full_name || "").slice(0,18).padEnd(18)}"  niche="${(lead.niche || "").slice(0,18).padEnd(18)}"  →  "${out.program_name}" (${out.confidence})`);
      console.log(`  bio: ${bioPreview}${(lead.bio||"").length>70?"…":""}\n`);
    } catch (e) {
      console.log(`@${lead.username}: ERROR ${e.message}`);
    }
  }
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
