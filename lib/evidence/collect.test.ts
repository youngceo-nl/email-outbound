import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collectCommercialEvidence, snapshotSourceIds } from "./collect";
import { normalizeInstagramEvidence, type RawInstagramUser } from "./instagram";
import type { PageFetcher } from "./external";
import type { PageFetchOutcome } from "./http";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

function fakeFetcher(pages: Record<string, string>): PageFetcher & { requested: string[] } {
  const requested: string[] = [];
  const fetcher = (async (url: string): Promise<PageFetchOutcome> => {
    requested.push(url);
    const html = pages[url];
    if (!html) return { ok: false, failure: { kind: "http_error", detail: "HTTP 404" } };
    return { ok: true, page: { html, finalUrl: url, redirectChain: [url], method: "free_fetch" } };
  }) as PageFetcher & { requested: string[] };
  fetcher.requested = requested;
  return fetcher;
}

function igEvidence(overrides: Partial<RawInstagramUser> = {}) {
  return normalizeInstagramEvidence({
    username: "jordanblake",
    user: {
      username: "jordanblake",
      full_name: "Jordan Blake | Business Coach",
      biography: "I help consultants get premium clients. Helped 139 clients. DM CLIENTS to apply",
      external_url: "https://linktr.ee/jordanblake",
      is_private: false,
      edge_followed_by: { count: 24000 },
      edge_follow: { count: 300 },
      edge_owner_to_timeline_media: {
        count: 300,
        edges: [
          {
            node: {
              shortcode: "post1",
              is_video: true,
              video_view_count: 9000,
              edge_media_to_caption: { edges: [{ node: { text: "Client did $50,000 last month" } }] },
              taken_at_timestamp: Math.floor(Date.now() / 1000) - 86400,
              pinned_for_users: [],
            },
          },
        ],
      },
      ...overrides,
    },
  });
}

const noYouTube = async () => ({ channels: [], videos: [], outbound_urls: [] });

test("collects Instagram first, then external, and freezes one snapshot", async () => {
  const fetcher = fakeFetcher({
    "https://linktr.ee/jordanblake": fixture("link-hub.html"),
    "https://jordanblake.com/coaching": fixture("coaching-page.html"),
    "https://jordanblake.com/apply": fixture("application-page.html"),
    "https://jordanblake.com/free-training": fixture("coaching-page.html"),
  });

  const snapshot = await collectCommercialEvidence({
    instagram: igEvidence(),
    dataQuality: "complete",
    dependencies: { fetchPage: fetcher, collectYouTube: noYouTube },
  });

  assert.equal(snapshot.username, "jordanblake");
  assert.ok(snapshot.snapshot_id.length > 0);
  assert.ok(snapshot.external_destinations.length >= 2);
  assert.equal(snapshot.acquisition_sufficiency, "sufficient");
  assert.equal(snapshot.versions.acquisition_version, "acquisition-1.1.0");

  // The DM funnel in the bio outranks the bio link as the primary CTA.
  assert.match(snapshot.primary_cta ?? "", /DM CLIENTS/i);
});

test("YouTube description links are followed within the shared hop budget", async () => {
  const fetcher = fakeFetcher({
    "https://linktr.ee/jordanblake": fixture("link-hub.html"),
    "https://jordanblake.com/coaching": fixture("coaching-page.html"),
    "https://jordanblake.com/apply": fixture("application-page.html"),
    "https://jordanblake.com/free-training": fixture("coaching-page.html"),
    "https://jordanblake.com/mastermind": fixture("coaching-page.html"),
  });

  const snapshot = await collectCommercialEvidence({
    instagram: igEvidence(),
    dataQuality: "complete",
    dependencies: {
      fetchPage: fetcher,
      collectYouTube: async () => ({
        channels: [
          {
            channel_id: "UC123",
            url: "https://www.youtube.com/@jordanblake",
            name: "Jordan Blake",
            handle: "jordanblake",
            description: "Apply at https://jordanblake.com/mastermind",
            subscribers: 40000,
            video_count: 120,
            outbound_urls: ["https://jordanblake.com/mastermind"],
            recent_video_titles: ["How I got 139 clients"],
            capture_status: "captured" as const,
            captured_at: "2026-07-31T00:00:00Z",
            error: null,
          },
        ],
        videos: [],
        outbound_urls: ["https://jordanblake.com/mastermind"],
      }),
    },
  });

  assert.ok(
    snapshot.external_destinations.some((d) => d.destination_id.startsWith("youtube_destination_")),
    "a YouTube description link should be inspected",
  );
  assert.ok(snapshot.hops_used <= 5);
});

test("YouTube as the primary CTA without a captured description is only partial", async () => {
  const snapshot = await collectCommercialEvidence({
    instagram: igEvidence({ external_url: "https://www.youtube.com/@jordanblake" }),
    dataQuality: "complete",
    dependencies: {
      fetchPage: fakeFetcher({}),
      collectYouTube: async () => ({
        channels: [
          {
            channel_id: "UC123",
            url: "https://www.youtube.com/@jordanblake",
            name: "Jordan Blake",
            handle: "jordanblake",
            description: null,
            subscribers: null,
            video_count: null,
            outbound_urls: [],
            recent_video_titles: [],
            capture_status: "failed" as const,
            captured_at: null,
            error: "blocked",
          },
        ],
        videos: [],
        outbound_urls: [],
      }),
    },
  });

  assert.notEqual(snapshot.acquisition_sufficiency, "sufficient");
  assert.ok(snapshot.unknown_surfaces.some((s) => s.surface.startsWith("youtube_channel:")));
});

test("a link hub whose children all fail stays partial, not sufficient", async () => {
  const fetcher = fakeFetcher({ "https://linktr.ee/jordanblake": fixture("link-hub.html") });
  const snapshot = await collectCommercialEvidence({
    instagram: igEvidence(),
    dataQuality: "complete",
    dependencies: { fetchPage: fetcher, collectYouTube: noYouTube },
  });

  assert.equal(snapshot.acquisition_sufficiency, "partial");
  assert.ok(snapshot.unknown_surfaces.some((s) => s.surface.startsWith("external:")));
});

test("failed captures are retained as unknown surfaces, never dropped", async () => {
  const snapshot = await collectCommercialEvidence({
    instagram: igEvidence({ external_url: "https://dead.example/page" }),
    dataQuality: "complete",
    dependencies: { fetchPage: fakeFetcher({}), collectYouTube: noYouTube },
  });

  assert.equal(snapshot.external_destinations.length, 1);
  assert.equal(snapshot.external_destinations[0].capture_status, "failed");
  assert.equal(snapshot.acquisition_sufficiency, "insufficient");
});

test("seeds a proof inventory with unknown beneficiaries", async () => {
  const snapshot = await collectCommercialEvidence({
    instagram: igEvidence(),
    dataQuality: "complete",
    dependencies: { fetchPage: fakeFetcher({}), collectYouTube: noYouTube },
  });

  assert.ok(snapshot.proof_inventory_seed.length > 0);
  for (const proof of snapshot.proof_inventory_seed) {
    // Deterministic code must never guess who a result belongs to.
    assert.equal(proof.beneficiary, "unknown");
    assert.ok(proof.evidence.length > 0);
  }
  assert.ok(snapshot.proof_inventory_seed.some((p) => /139/.test(p.claim)));
});

test("exposes exactly the source ids a model may cite", async () => {
  const fetcher = fakeFetcher({
    "https://linktr.ee/jordanblake": fixture("link-hub.html"),
    "https://jordanblake.com/coaching": fixture("coaching-page.html"),
    "https://jordanblake.com/apply": fixture("application-page.html"),
    "https://jordanblake.com/free-training": fixture("coaching-page.html"),
  });
  const snapshot = await collectCommercialEvidence({
    instagram: igEvidence(),
    dataQuality: "complete",
    dependencies: { fetchPage: fetcher, collectYouTube: noYouTube },
  });

  const ids = snapshotSourceIds(snapshot);
  assert.ok(ids.has("bio:profile"));
  assert.ok(ids.has("display_name:profile"));
  assert.ok(ids.has("recent_post:post1"));
  assert.ok(ids.has("external_page:destination_0"));
  assert.ok(!ids.has("external_page:destination_99"));
});

test("the CTA chain stays sequential after YouTube follow-ups are merged", async () => {
  const fetcher = fakeFetcher({
    "https://linktr.ee/jordanblake": fixture("link-hub.html"),
    "https://jordanblake.com/coaching": fixture("coaching-page.html"),
    "https://jordanblake.com/apply": fixture("application-page.html"),
    "https://jordanblake.com/free-training": fixture("coaching-page.html"),
    "https://jordanblake.com/mastermind": fixture("coaching-page.html"),
  });
  const snapshot = await collectCommercialEvidence({
    instagram: igEvidence(),
    dataQuality: "complete",
    dependencies: {
      fetchPage: fetcher,
      collectYouTube: async () => ({
        channels: [],
        videos: [],
        outbound_urls: ["https://jordanblake.com/mastermind"],
      }),
    },
  });

  snapshot.cta_chain.forEach((hop, index) => assert.equal(hop.hop, index));
});
