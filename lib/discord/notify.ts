import "server-only";

// Fire-and-forget alert to a Discord channel via incoming webhook. Alerting
// must never break the inbox sync it's reporting on, so failures are logged,
// not thrown.
export async function notifyDiscord(content: string): Promise<void> {
  const url = process.env.DISCORD_REPLIES_WEBHOOK_URL;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      console.error("[discord] webhook post failed:", res.status, await res.text());
    }
  } catch (err) {
    console.error("[discord] webhook post failed:", (err as Error).message);
  }
}
