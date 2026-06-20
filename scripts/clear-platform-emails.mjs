// One-shot: null out any email where the domain is a known platform
// (not the person's own domain). These are domain-inference artifacts
// that would bounce if sent to.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const PLATFORM_DOMAINS = [
  "instagram.com", "youtube.com", "youtu.be", "tiktok.com", "twitter.com", "x.com",
  "facebook.com", "linkedin.com", "snapchat.com", "pinterest.com", "threads.net",
  "linktree.com", "linktr.ee", "beacons.ai", "bio.link", "stan.store", "taplink.cc",
  "koji.to", "campsite.bio", "later.com", "allmylinks.com", "linkinbio.com", "linktw.in",
  "lnk.bio", "contactinbio.com", "milkshake.app",
  "whop.com", "gumroad.com", "patreon.com", "substack.com", "kajabi.com",
  "teachable.com", "thinkific.com", "podia.com", "skool.com", "circle.so",
  "clickfunnels.com", "gohighlevel.com", "systeme.io", "kartra.com",
  "shopify.com", "etsy.com", "squarespace.com", "wixsite.com", "wordpress.com",
  "webflow.io", "webflow.com",
  "bit.ly", "t.co", "ow.ly", "buff.ly", "rb.gy", "tinyurl.com", "short.io",
  "go.to", "amzn.to",
  "calendly.com", "typeform.com", "notion.so", "spotify.com", "apple.com",
  "anchor.fm", "buzzsprout.com",
];

const sb = createClient(url, key, { auth: { persistSession: false } });

const { data: leads, error } = await sb
  .from("leads")
  .select("id, username, email")
  .not("email", "is", null);

if (error) {
  console.error("Failed to fetch leads:", error.message);
  process.exit(1);
}

const toWipe = leads.filter((l) => {
  const email = l.email;
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return PLATFORM_DOMAINS.some((p) => domain === p || domain.endsWith("." + p));
});

if (toWipe.length === 0) {
  console.log("No platform emails found — nothing to do.");
  process.exit(0);
}

console.log(`Found ${toWipe.length} platform email(s) to clear:`);
for (const l of toWipe) console.log(`  @${l.username} → ${l.email}`);

const ids = toWipe.map((l) => l.id);
const { error: updateError } = await sb
  .from("leads")
  .update({ email: null, email_status: null, email_provider: null, enriched_at: null, enrichment_error: null })
  .in("id", ids);

if (updateError) {
  console.error("Update failed:", updateError.message);
  process.exit(1);
}

console.log(`Cleared ${toWipe.length} platform email(s).`);
process.exit(0);
