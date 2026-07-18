#!/usr/bin/env node
// Local-dev Telegram bridge. Uses long-polling instead of a webhook so no
// tunnel is needed. On startup it removes any registered webhook, then
// forwards every incoming message to the local Next.js webhook route.
// In production, instrumentation.ts re-registers the real webhook on boot.
import { readFileSync, existsSync } from "fs";

function parseEnvFile(path) {
  const vars = {};
  if (!existsSync(path)) return vars;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (k && !k.startsWith("#")) vars[k] = v;
  }
  return vars;
}

const env = parseEnvFile(".env.local");
const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
const LOCAL_URL = "http://localhost:3000/api/telegram/webhook";
const SECRET = env.TELEGRAM_WEBHOOK_SECRET || "";

if (!BOT_TOKEN) {
  console.error("[telegram-poll] TELEGRAM_BOT_TOKEN not set in .env.local");
  process.exit(1);
}

const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());

async function start() {
  // Remove any stale webhook so getUpdates works
  const del = await api("deleteWebhook", { drop_pending_updates: false });
  if (del.ok) {
    console.log("[telegram-poll] webhook cleared — starting long-poll");
  } else {
    console.warn("[telegram-poll] deleteWebhook failed:", del.description);
  }

  let offset = 0;
  while (true) {
    let updates;
    try {
      const res = await api("getUpdates", { offset, timeout: 30, allowed_updates: ["message"] });
      if (!res.ok) {
        console.error("[telegram-poll] getUpdates error:", res.description);
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      updates = res.result;
    } catch (err) {
      console.error("[telegram-poll] fetch error:", err.message);
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    for (const update of updates) {
      offset = update.update_id + 1;
      try {
        const headers = { "Content-Type": "application/json" };
        if (SECRET) headers["x-telegram-bot-api-secret-token"] = SECRET;
        const res = await fetch(LOCAL_URL, {
          method: "POST",
          headers,
          body: JSON.stringify(update),
        });
        if (!res.ok) {
          console.warn(`[telegram-poll] local webhook returned ${res.status} for update ${update.update_id}`);
        }
      } catch (err) {
        console.error(`[telegram-poll] failed to forward update ${update.update_id}:`, err.message);
      }
    }
  }
}

start().catch((err) => {
  console.error("[telegram-poll] fatal:", err);
  process.exit(1);
});
