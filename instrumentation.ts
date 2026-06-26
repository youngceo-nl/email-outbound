// Runs once on server startup. Auto-registers the Telegram webhook so any
// deployment (Vercel, Railway, etc.) stays in sync without manual steps.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const appUrl = process.env.APP_URL;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  // Skip if not configured or pointing at localhost (dev tunnel handles that)
  if (!botToken || !appUrl || appUrl.includes("localhost")) return;

  const webhookUrl = `${appUrl}/api/telegram/webhook`;
  const body: Record<string, string> = { url: webhookUrl };
  if (secret) body.secret_token = secret;

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json() as { ok: boolean; description?: string };
    if (data.ok) {
      console.log(`[telegram] webhook registered → ${webhookUrl}`);
    } else {
      console.warn(`[telegram] webhook registration failed: ${data.description}`);
    }
  } catch (err) {
    console.warn("[telegram] webhook registration error:", err);
  }
}
