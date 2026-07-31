"use server";
import { createClient } from "@/lib/supabase/server";
import { encode } from "@msgpack/msgpack";

async function requireUser() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("unauthorized");
}

export type GenerateVoiceClipResult =
  | { ok: true; audioBase64: string }
  | { ok: false; error: string };

export async function generateVoiceClip(text: string): Promise<GenerateVoiceClipResult> {
  await requireUser();

  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Type a message first." };

  const apiKey = process.env.FISHAUDIO_API_KEY;
  const referenceId = process.env.FISHAUDIO_REFERENCE_ID;
  if (!apiKey || !referenceId) {
    return {
      ok: false,
      error: "FISHAUDIO_API_KEY / FISHAUDIO_REFERENCE_ID not set in .env.local.",
    };
  }

  const payload = encode({
    text: trimmed,
    format: "wav",
    reference_id: referenceId,
    normalize: true,
    latency: "balanced",
  });

  let res: Response;
  try {
    res = await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/msgpack",
        "model": "speech-1.5",
      },
      body: payload as BodyInit,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Network error calling Fish Audio: ${msg}` };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, error: `Fish Audio error (${res.status}): ${body.slice(0, 300)}` };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: true, audioBase64: buf.toString("base64") };
}
