import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collectExternalEvidence, rankFunnelLinks, type PageFetcher } from "./external";
import { classifyDestination, extractPage } from "./page-extract";
import type { PageFetchOutcome } from "./http";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

/** Serves fixtures by URL and records what the collector actually requested. */
function fakeFetcher(pages: Record<string, string>): PageFetcher & { requested: string[] } {
  const requested: string[] = [];
  const fetcher = (async (url: string): Promise<PageFetchOutcome> => {
    requested.push(url);
    const html = pages[url];
    if (!html) {
      return { ok: false, failure: { kind: "http_error", detail: "HTTP 404" } };
    }
    return {
      ok: true,
      page: { html, finalUrl: url, redirectChain: [url], method: "free_fetch" },
    };
  }) as PageFetcher & { requested: string[] };
  fetcher.requested = requested;
  return fetcher;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

test("ranks commercially relevant link-hub children above social and legal links", () => {
  const extraction = extractPage({ html: fixture("link-hub.html"), url: "https://linktr.ee/jordanblake" });
  const ranked = rankFunnelLinks({ pageUrl: "https://linktr.ee/jordanblake", extraction });

  const urls = ranked.map((link) => link.url);
  const top = urls.slice(0, 4);
  assert.ok(top.some((u) => u.includes("/coaching")), "coaching should rank near the top");
  assert.ok(top.some((u) => u.includes("/apply")), "apply should rank near the top");
  assert.ok(top.some((u) => u.includes("/free-training")), "free training should rank near the top");

  const privacy = ranked.find((link) => link.url.includes("/privacy"));
  const instagram = ranked.find((link) => link.url.includes("instagram.com"));
  assert.ok(privacy, "privacy link is retained as evidence, not dropped");
  assert.ok((privacy?.score ?? 0) < 0, "privacy link is deprioritized");
  assert.ok((instagram?.score ?? 0) < 0, "social profile is deprioritized");
});

test("every candidate records why it was selected", () => {
  const extraction = extractPage({ html: fixture("link-hub.html"), url: "https://linktr.ee/jordanblake" });
  const ranked = rankFunnelLinks({ pageUrl: "https://linktr.ee/jordanblake", extraction });
  for (const link of ranked) {
    assert.ok(link.reasons.length > 0, `${link.url} has no selection reason`);
  }
});

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

test("classifies a coaching page as education with an implementation role", () => {
  const extraction = extractPage({ html: fixture("coaching-page.html"), url: "https://jordanblake.com/coaching" });
  assert.equal(extraction.destination_type, "education");
  assert.ok(extraction.prices.some((p) => p.includes("4,000")));
  assert.ok(extraction.cta_labels.some((cta) => /apply/i.test(cta.label)));
});

test("classifies a done-for-you page as agency_service via the corroborated bundle", () => {
  const extraction = extractPage({ html: fixture("agency-page.html"), url: "https://growthpartners.com" });
  assert.equal(extraction.destination_type, "agency_service");
  assert.deepEqual(extraction.visitor_receives, ["done_for_you_service"]);
  assert.match(extraction.classification_reason, /agency bundle/);
});

test("the bare word agency never classifies a page as a service business", () => {
  const html = `<html><head><title>Coach</title></head><body>
    <h1>I run an agency and I teach coaches</h1>
    <p>My 1:1 coaching program teaches you the curriculum I use. Students get lifetime access.</p>
    <a href="/apply">Apply for coaching</a></body></html>`;
  const result = classifyDestination({
    url: "https://example.com/about",
    title: "Coach",
    metaDescription: null,
    headings: ["I run an agency and I teach coaches"],
    offerCopy: ["My 1:1 coaching program teaches you the curriculum I use."],
    ctaLabels: [{ label: "Apply for coaching", url: "/apply" }],
    bodyText: extractPage({ html, url: "https://example.com/about" }).text_excerpt,
  });
  assert.notEqual(result.type, "agency_service");
});

test("classifies known platform hosts without needing page content", () => {
  const base = { title: null, metaDescription: null, headings: [], offerCopy: [], ctaLabels: [], bodyText: "" };
  assert.equal(classifyDestination({ ...base, url: "https://calendly.com/x/30min" }).type, "booking");
  assert.equal(classifyDestination({ ...base, url: "https://www.skool.com/community" }).type, "community");
  assert.equal(classifyDestination({ ...base, url: "https://linktr.ee/x" }).type, "link_hub");
  assert.equal(classifyDestination({ ...base, url: "https://youtu.be/abc" }).type, "youtube");
  assert.equal(classifyDestination({ ...base, url: "https://form.typeform.com/to/x" }).type, "application");
});

// ---------------------------------------------------------------------------
// Traversal
// ---------------------------------------------------------------------------

test("traverses a link hub, keeps every destination, and resolves the outcome", async () => {
  const fetcher = fakeFetcher({
    "https://linktr.ee/jordanblake": fixture("link-hub.html"),
    "https://jordanblake.com/coaching": fixture("coaching-page.html"),
    "https://jordanblake.com/apply": fixture("application-page.html"),
    "https://jordanblake.com/free-training": fixture("coaching-page.html"),
  });

  const result = await collectExternalEvidence({
    externalLink: "https://linktr.ee/jordanblake",
    fetcher,
  });

  const types = result.destinations.map((d) => d.destination_type);
  assert.ok(types.includes("link_hub"));
  assert.ok(types.includes("education"));
  assert.equal(result.stop_reason, "ultimate_outcome_resolved");
  assert.equal(result.capture_status, "captured");

  // The YouTube child is inventoried and handed off rather than scraped as HTML.
  assert.ok(result.youtube_urls.some((u) => u.includes("youtube.com/@jordanblake")));
  assert.ok(!fetcher.requested.some((u) => u.includes("youtube.com")));

  // CTA chain must start at the profile and stay sequential.
  assert.equal(result.cta_hops[0].source_type, "instagram_profile");
  result.cta_hops.forEach((hop, i) => assert.equal(hop.hop, i));
});

test("honours the default child budget of three", async () => {
  const fetcher = fakeFetcher({
    "https://linktr.ee/jordanblake": fixture("link-hub.html"),
    "https://jordanblake.com/coaching": fixture("coaching-page.html"),
    "https://jordanblake.com/apply": fixture("application-page.html"),
    "https://jordanblake.com/free-training": fixture("coaching-page.html"),
  });
  await collectExternalEvidence({ externalLink: "https://linktr.ee/jordanblake", fetcher });
  const childFetches = fetcher.requested.filter((u) => !u.includes("linktr.ee"));
  assert.ok(childFetches.length <= 3, `expected at most 3 children, got ${childFetches.length}`);
});

test("detects cycles instead of looping forever", async () => {
  const loopA = `<html><body><a href="https://a.com/two">Apply now</a></body></html>`;
  const loopB = `<html><body><a href="https://a.com/one">Apply now</a></body></html>`;
  const fetcher = fakeFetcher({ "https://a.com/one": loopA, "https://a.com/two": loopB });

  const result = await collectExternalEvidence({ externalLink: "https://a.com/one", fetcher });
  assert.ok(["cycle_detected", "ultimate_outcome_resolved", "max_hops_reached"].includes(result.stop_reason));
  assert.ok(fetcher.requested.length <= 6, "cycle must not exhaust the budget repeatedly");
});

test("a failed fetch is recorded as failure, never as an absent offer", async () => {
  const fetcher = fakeFetcher({});
  const result = await collectExternalEvidence({ externalLink: "https://gone.example/x", fetcher });

  assert.equal(result.destinations.length, 1);
  assert.equal(result.destinations[0].capture_status, "failed");
  assert.equal(result.destinations[0].destination_type, "unknown");
  assert.equal(result.stop_reason, "destination_unavailable");
  assert.equal(result.capture_status, "failed");
});

test("no external link is a captured fact, not a failure", async () => {
  const result = await collectExternalEvidence({ externalLink: null, fetcher: fakeFetcher({}) });
  assert.equal(result.stop_reason, "no_external_link");
  assert.equal(result.capture_status, "captured");
  assert.equal(result.destinations.length, 0);
});

test("an authentication wall is unavailable, not failed", async () => {
  const fetcher: PageFetcher = async () => ({
    ok: false,
    failure: { kind: "auth_required", detail: "HTTP 403" },
  });
  const result = await collectExternalEvidence({ externalLink: "https://members.example/x", fetcher });
  assert.equal(result.destinations[0].capture_status, "unavailable");
  assert.equal(result.stop_reason, "authentication_required");
});

test("respects the absolute hop ceiling", async () => {
  const chain: Record<string, string> = {};
  for (let i = 0; i < 12; i++) {
    chain[`https://chain.example/${i}`] = `<html><body><a href="https://chain.example/${i + 1}">Apply now</a></body></html>`;
  }
  const fetcher = fakeFetcher(chain);
  const result = await collectExternalEvidence({
    externalLink: "https://chain.example/0",
    fetcher,
    config: { defaultHopBudget: 3, absoluteHopBudget: 5 },
  });
  assert.ok(result.hops_used <= 5, `hops_used was ${result.hops_used}`);
});
