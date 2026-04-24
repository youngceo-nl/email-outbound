// Standalone test: how reliably can we read IG follower counts for FREE
// (direct web_profile_info, no ScrapingBee, no Apify)?
//
// Usage:
//   node scripts/test-ig-fetch.mjs [count]          # free, direct from this IP
//   IG_PROXY_URL=http://user:pass@host:port node scripts/test-ig-fetch.mjs 20
//
// Pulls real usernames from your Supabase `leads` table, fetches each profile's
// follower count, and prints a success-rate summary so you can decide whether
// the free path is good enough or you need residential proxies.

import { readFileSync } from "node:fs";

// --- tiny .env.local parser (no dotenv dep) ---
function loadEnv(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      out[m[1]] = v;
    }
  } catch { /* file optional */ }
  return out;
}

const env = { ...loadEnv(".env.local"), ...process.env };
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const PROXY_URL = env.IG_PROXY_URL || null;
const COUNT = parseInt(process.argv[2] || "20", 10);
const CONCURRENCY = 3;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

// --- optional residential proxy via undici (only if IG_PROXY_URL set) ---
let dispatcher = null;
if (PROXY_URL) {
  try {
    const { ProxyAgent } = await import("undici");
    dispatcher = new ProxyAgent(PROXY_URL);
    console.log(`Using proxy: ${PROXY_URL.replace(/\/\/[^@]*@/, "//***@")}`);
  } catch (e) {
    console.error("Could not load undici ProxyAgent:", e.message);
    process.exit(1);
  }
} else {
  console.log("No IG_PROXY_URL set — testing the FREE direct path from this machine's IP.");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => 600 + Math.floor(Math.random() * 900);

async function getUsernames(n) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?select=username&username=not.is.null&limit=${n}`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
  );
  const rows = await res.json();
  return [...new Set(rows.map((r) => r.username).filter(Boolean))];
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
  const status = res.status;
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, status, reason: status === 200 ? "non_json_html (login wall?)" : `http_${status}` };
  }
  const user = json?.data?.user;
  if (user) {
    return {
      ok: true,
      status,
      followers: user.edge_followed_by?.count ?? null,
      private: !!user.is_private,
    };
  }
  const msg = json?.message ? `: ${json.message}` : "";
  return { ok: false, status, reason: `no_user (http_${status})${msg}` };
}

async function run() {
  const usernames = await getUsernames(COUNT);
  console.log(`Testing ${usernames.length} profiles, concurrency ${CONCURRENCY}\n`);

  const results = [];
  let i = 0;
  async function worker() {
    while (i < usernames.length) {
      const idx = i++;
      const u = usernames[idx];
      try {
        const r = await fetchFollowers(u);
        results.push({ u, ...r });
        console.log(
          r.ok
            ? `  ✓ @${u} — ${r.followers?.toLocaleString() ?? "?"} followers${r.private ? " (private)" : ""}`
            : `  ✗ @${u} — ${r.reason}`,
        );
      } catch (e) {
        results.push({ u, ok: false, reason: e.message });
        console.log(`  ✗ @${u} — error: ${e.message}`);
      }
      await sleep(jitter());
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const ok = results.filter((r) => r.ok).length;
  const rate = results.length ? Math.round((ok / results.length) * 100) : 0;
  console.log(`\n──────── RESULT ────────`);
  console.log(`Success: ${ok}/${results.length} (${rate}%)  ${dispatcher ? "[via proxy]" : "[free/direct]"}`);
  const fails = {};
  for (const r of results.filter((x) => !x.ok)) {
    const key = (r.reason || "unknown").split(":")[0];
    fails[key] = (fails[key] || 0) + 1;
  }
  if (Object.keys(fails).length) {
    console.log("Failure breakdown:");
    for (const [k, n] of Object.entries(fails).sort((a, b) => b[1] - a[1])) console.log(`  ${n}× ${k}`);
  }
  if (rate >= 80) console.log("\n→ Free path looks viable. Worth wiring in front of ScrapingBee.");
  else if (rate >= 30) console.log("\n→ Partial. Free-first with paid fallback would still cut costs.");
  else console.log("\n→ Mostly blocked from this IP. You'll need residential proxies (set IG_PROXY_URL).");
}

run().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
