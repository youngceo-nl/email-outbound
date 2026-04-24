// Refresh follower counts for ALL leads — FREE, direct web_profile_info.
// Best run LOCALLY (residential IP). On a datacenter IP set IG_PROXY_URL.
//
// Usage:
//   node scripts/refresh-followers.mjs               # all leads
//   node scripts/refresh-followers.mjs 50            # cap at 50
//   IG_PROXY_URL=http://user:pass@host:port node scripts/refresh-followers.mjs
//
// Writes the fresh `followers` value back to each lead in Supabase.

import { readFileSync } from "node:fs";

function loadEnv(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[m[1]] = v;
    }
  } catch { /* optional */ }
  return out;
}

const env = { ...loadEnv(".env.local"), ...process.env };
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const PROXY_URL = env.IG_PROXY_URL || null;
const CAP = process.argv[2] ? parseInt(process.argv[2], 10) : Infinity;
const CONCURRENCY = 3;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing Supabase env vars in .env.local");
  process.exit(1);
}

let dispatcher = null;
if (PROXY_URL) {
  const { ProxyAgent } = await import("undici");
  dispatcher = new ProxyAgent(PROXY_URL);
  console.log(`Using proxy: ${PROXY_URL.replace(/\/\/[^@]*@/, "//***@")}`);
} else {
  console.log("FREE direct mode (best from a residential IP).");
}

const SB = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => 500 + Math.floor(Math.random() * 800);

async function getAllLeads() {
  const out = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?select=id,username&username=not.is.null&order=created_at.asc`,
      { headers: { ...SB, Range: `${from}-${from + page - 1}` } },
    );
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < page) break;
    if (out.length >= CAP) break;
  }
  return out.slice(0, CAP);
}

async function fetchFollowers(username) {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
  const opts = {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "X-IG-App-ID": "936619743392459",
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": `https://www.instagram.com/${username}/`,
      "X-Requested-With": "XMLHttpRequest",
    },
  };
  if (dispatcher) opts.dispatcher = dispatcher;
  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { return { ok: false, reason: `http_${res.status}` }; }
  const user = json?.data?.user;
  if (!user) return { ok: false, reason: `no_user_http_${res.status}` };
  return { ok: true, followers: user.edge_followed_by?.count ?? 0 };
}

async function updateLead(id, followers) {
  await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...SB, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ followers }),
  });
}

async function run() {
  const leads = await getAllLeads();
  console.log(`Refreshing ${leads.length} leads, concurrency ${CONCURRENCY}\n`);
  let i = 0, updated = 0, failed = 0;

  async function worker() {
    while (i < leads.length) {
      const idx = i++;
      const { id, username } = leads[idx];
      try {
        const r = await fetchFollowers(username);
        if (r.ok) {
          await updateLead(id, r.followers);
          updated++;
          if (updated % 25 === 0 || idx === leads.length - 1) {
            console.log(`  [${idx + 1}/${leads.length}] updated=${updated} failed=${failed} — last @${username} ${r.followers.toLocaleString()}`);
          }
        } else {
          failed++;
          if (failed <= 10) console.log(`  ✗ @${username} — ${r.reason}`);
        }
      } catch (e) {
        failed++;
        if (failed <= 10) console.log(`  ✗ @${username} — ${e.message}`);
      }
      await sleep(jitter());
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`\n──────── DONE ────────`);
  console.log(`Updated ${updated}/${leads.length}  ·  failed ${failed}  ${dispatcher ? "[proxy]" : "[free]"}`);
}

run().catch((e) => { console.error("fatal:", e); process.exit(1); });
