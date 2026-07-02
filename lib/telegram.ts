import "server-only";

// Separate bot from TELEGRAM_BOT_TOKEN (the lead-analysis bot) so crash
// alerts don't mix into that chat.
const ALERTS_BOT_TOKEN = process.env.TELEGRAM_ALERTS_BOT_TOKEN;
const ALERT_CHAT_ID = process.env.TELEGRAM_ALERT_CHAT_ID;

// Best-effort alert to the admin's Telegram chat. Silently no-ops if either
// env var is missing so this never becomes the reason a job fails. Returns
// whether Telegram actually accepted the message — callers that dedupe
// repeat alerts need this, since a network-level "success" can still carry
// an { ok: false } body (e.g. chat not found).
export async function sendTelegramAlert(text: string): Promise<boolean> {
  if (!ALERTS_BOT_TOKEN || !ALERT_CHAT_ID) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${ALERTS_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: ALERT_CHAT_ID, text }),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return res.ok && data?.ok === true;
  } catch {
    /* best-effort — never let an alert failure mask the original error */
    return false;
  }
}
