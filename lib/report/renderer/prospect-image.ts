/*
 * Fetches the prospect's profile photo and inlines it as a data URI.
 *
 * Why fetch at render time instead of embedding the stored URL: Instagram CDN
 * links are signed and expire within days, and the PDF is produced by a headless
 * browser that may be running remotely. A stale or unreachable URL in the
 * document would render as a broken-image box on a cover page going to a
 * prospect — so the bytes are resolved here, once, and any failure degrades to a
 * monogram instead.
 *
 * The URL is semi-trusted: it arrives from a scrape, not from us. It is
 * host-allowlisted, scheme-checked, size-capped and time-capped before a single
 * byte is used.
 */

/** Meta's CDN hosts. Nothing else is fetchable through this path. */
const ALLOWED_HOST_SUFFIXES = [".cdninstagram.com", ".fbcdn.net"];

const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type ProspectImage = { dataUri: string; bytes: number; contentType: string };

export type ProspectImageResult =
  | { ok: true; image: ProspectImage }
  | { ok: false; reason: "missing" | "blocked_host" | "bad_scheme" | "expired" | "too_large" | "wrong_type" | "network" };

function hostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export async function fetchProspectImage(url: string | null | undefined): Promise<ProspectImageResult> {
  if (!url) return { ok: false, reason: "missing" };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "bad_scheme" };
  }

  // https only: an http fetch would be a downgrade and, together with the host
  // allowlist, this is what keeps a scraped string from becoming an SSRF vector.
  if (parsed.protocol !== "https:") return { ok: false, reason: "bad_scheme" };
  if (!hostAllowed(parsed.hostname)) return { ok: false, reason: "blocked_host" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(parsed, { signal: controller.signal, redirect: "follow" });

    // A 403 here is the normal, expected outcome for a signed URL that has aged
    // out — not an error worth logging loudly.
    if (response.status === 403 || response.status === 410) return { ok: false, reason: "expired" };
    if (!response.ok) return { ok: false, reason: "network" };

    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_TYPES.includes(contentType)) return { ok: false, reason: "wrong_type" };

    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_BYTES) return { ok: false, reason: "too_large" };

    const buffer = Buffer.from(await response.arrayBuffer());
    // Re-check after reading: content-length is a hint, not a guarantee.
    if (buffer.byteLength > MAX_BYTES) return { ok: false, reason: "too_large" };
    if (buffer.byteLength === 0) return { ok: false, reason: "network" };

    return {
      ok: true,
      image: {
        dataUri: `data:${contentType};base64,${buffer.toString("base64")}`,
        bytes: buffer.byteLength,
        contentType,
      },
    };
  } catch {
    // AbortError included: a slow CDN must not hold up report generation.
    return { ok: false, reason: "network" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Initials for the monogram shown when there is no usable photo.
 *
 * Every failure path above ends here, so a blocked, private or expired image
 * still produces a deliberate-looking cover rather than a gap.
 */
export function monogram(displayName: string, username: string): string {
  const source = displayName.trim() || username.trim();
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase() || "?";
}
