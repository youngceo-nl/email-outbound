/*
 * Persists profile/post images to Supabase Storage so Gate 2's visual
 * evidence ("the individual appears prominently in the content") survives
 * past the moment of acquisition.
 *
 * Instagram CDN URLs are signed and expire within days — see
 * lib/report/renderer/prospect-image.ts, which solves the same problem for
 * report rendering by fetching at render time instead. That trick does not
 * work here: the evidence snapshot must be replayable months later against
 * exactly the bytes a decision was made from (lib/qualification/run.ts,
 * requalifyFromSnapshot), so the bytes are downloaded once, at acquisition
 * time, and stored under the snapshot's own id.
 *
 * The same safety posture as fetchProspectImage applies: the URL is
 * semi-trusted (it comes from a scrape, not from us), so it is
 * host-allowlisted, scheme-checked, size-capped, and type-checked before a
 * single byte is used.
 *
 * No `server-only` import — this must stay runnable under `tsx` for tests and
 * the qualification CLI, same rationale as lib/qualification/repository.ts.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { CaptureStatus, StoredImage } from "@/lib/qualification/types";

const BUCKET = "lead-images";

/** Meta's CDN hosts. Nothing else is fetchable through this path. */
const ALLOWED_HOST_SUFFIXES = [".cdninstagram.com", ".fbcdn.net"];
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Hard cap on images persisted per lead — profile pic plus up to 9 post thumbnails. */
export const MAX_IMAGES_PER_LEAD = 10;

export type ImageCandidate = {
  source_id: string;
  source_type: StoredImage["source_type"];
  url: string | null;
};

function hostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

async function downloadValidated(
  url: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (!hostAllowed(parsed.hostname)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(parsed, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) return null;

    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!(contentType in ALLOWED_TYPES)) return null;

    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_BYTES) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_BYTES || buffer.byteLength === 0) return null;

    return { buffer, contentType };
  } catch {
    // Timeout included: a slow CDN must not hold up acquisition.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/*
 * Downloads and uploads each candidate independently. A failure on one image
 * (expired signed URL, oversized file, network hiccup) never fails the whole
 * batch — it is recorded as `unavailable` and acquisition proceeds. Vision
 * extraction treats a missing image as unknown, never as evidence of absence.
 */
export async function persistLeadImages(opts: {
  /** Storage path prefix — the lead id keeps re-acquisitions overwriting in place. */
  keyPrefix: string;
  candidates: ImageCandidate[];
  maxImages?: number;
}): Promise<{ images: StoredImage[]; capture_status: CaptureStatus }> {
  const candidates = opts.candidates
    .filter((candidate) => candidate.url)
    .slice(0, opts.maxImages ?? MAX_IMAGES_PER_LEAD);

  if (candidates.length === 0) {
    return { images: [], capture_status: "not_attempted" };
  }

  const sb = createAdminClient();
  const images: StoredImage[] = [];
  let anyCaptured = false;

  for (const candidate of candidates) {
    const url = candidate.url as string;
    const downloaded = await downloadValidated(url);
    if (!downloaded) {
      images.push({
        source_id: candidate.source_id,
        source_type: candidate.source_type,
        original_url: url,
        storage_path: null,
        capture_status: "failed",
      });
      continue;
    }

    const ext = ALLOWED_TYPES[downloaded.contentType];
    const path = `${opts.keyPrefix}/${candidate.source_id}.${ext}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, downloaded.buffer, {
      contentType: downloaded.contentType,
      upsert: true,
    });

    if (error) {
      images.push({
        source_id: candidate.source_id,
        source_type: candidate.source_type,
        original_url: url,
        storage_path: null,
        capture_status: "failed",
      });
      continue;
    }

    anyCaptured = true;
    images.push({
      source_id: candidate.source_id,
      source_type: candidate.source_type,
      original_url: url,
      storage_path: path,
      capture_status: "captured",
    });
  }

  return { images, capture_status: anyCaptured ? "captured" : "failed" };
}

/** Signed URL for a stored image, for the vision pass to read at inference time. */
export async function signedLeadImageUrl(path: string, expiresInSeconds = 300): Promise<string | null> {
  const sb = createAdminClient();
  const { data } = await sb.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  return data?.signedUrl ?? null;
}

/** Downloads a stored image's raw bytes, e.g. to build a vision request. */
export async function downloadLeadImage(path: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const sb = createAdminClient();
  const { data } = await sb.storage.from(BUCKET).download(path);
  if (!data) return null;
  const buffer = Buffer.from(await data.arrayBuffer());
  const contentType = data.type || "image/jpeg";
  return { buffer, contentType };
}

/** Candidate list builder: profile pic first, then post thumbnails, capped. */
export function buildImageCandidates(opts: {
  profilePicUrl: string | null;
  posts: Array<{ post_id: string; thumbnail_url?: string | null }>;
  maxPosts?: number;
}): ImageCandidate[] {
  const out: ImageCandidate[] = [];
  if (opts.profilePicUrl) {
    out.push({ source_id: "profile", source_type: "profile_image", url: opts.profilePicUrl });
  }
  const maxPosts = opts.maxPosts ?? MAX_IMAGES_PER_LEAD - 1;
  for (const post of opts.posts) {
    if (out.length - (opts.profilePicUrl ? 1 : 0) >= maxPosts) break;
    if (!post.thumbnail_url) continue;
    out.push({ source_id: post.post_id, source_type: "post_image", url: post.thumbnail_url });
  }
  return out;
}
