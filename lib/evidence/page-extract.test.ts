import test from "node:test";
import assert from "node:assert/strict";
import { detectTrackingPixels, extractPage } from "./page-extract";

// ---------------------------------------------------------------------------
// Paid-offer, offer-status, and tracking signals
//
// Added for the "Revised Instagram ICP Qualification Logic" spec, which
// repeatedly needs paid-vs-free and active-vs-inactive offer evidence
// ("do not qualify based solely on a free course", "coaches whose paid offer
// is no longer active"), plus retargeting/paid-ad indicators as a funnel
// maturity signal.
// ---------------------------------------------------------------------------

test("a checkout page with a payment plan produces paid_offer_signals", () => {
  const html = `<!doctype html><html><head><title>Enroll in the Program</title></head><body>
    <h1>The Client Acceleration Program</h1>
    <p>Choose a payment plan or pay in full to secure your spot.</p>
    <a href="https://checkout.stripe.com/pay/cs_test_123">Enroll Now</a>
  </body></html>`;
  const extraction = extractPage({ html, url: "https://example.com/program" });

  assert.ok(extraction.paid_offer_signals.some((s) => /payment plan/i.test(s)));
  assert.ok(extraction.paid_offer_signals.some((s) => s.startsWith("checkout_host:")));
});

test("a page with no payment language produces no paid_offer_signals", () => {
  const html = `<!doctype html><html><head><title>My Free Newsletter</title></head><body>
    <p>Join my free weekly newsletter for tips and stories.</p>
  </body></html>`;
  const extraction = extractPage({ html, url: "https://example.com/newsletter" });

  assert.deepEqual(extraction.paid_offer_signals, []);
});

test("waitlist and closed-enrollment language produces offer_status_signals", () => {
  const html = `<!doctype html><html><head><title>Applications</title></head><body>
    <p>Enrollment is closed for this cohort. Join the waitlist for the next round.</p>
  </body></html>`;
  const extraction = extractPage({ html, url: "https://example.com/apply" });

  assert.ok(extraction.offer_status_signals.length > 0);
  assert.ok(extraction.offer_status_signals.some((s) => /waitlist/i.test(s)));
});

test("an active-sounding page produces no offer_status_signals", () => {
  const html = `<!doctype html><html><head><title>Apply Now</title></head><body>
    <p>Book a call to see if this program is right for you.</p>
  </body></html>`;
  const extraction = extractPage({ html, url: "https://example.com/apply" });

  assert.deepEqual(extraction.offer_status_signals, []);
});

test("a Meta pixel is detected even though scripts are stripped from the excerpt", () => {
  const html = `<!doctype html><html><head>
    <script>!function(f,b,e,v,n,t,s){/* fbq init */} fbq('init', '123456789');</script>
  </head><body><p>Welcome.</p></body></html>`;
  const extraction = extractPage({ html, url: "https://example.com/landing" });

  assert.ok(extraction.tracking_signals.includes("meta_pixel"));
  // The script tag itself must not leak into the text excerpt.
  assert.ok(!extraction.text_excerpt.includes("fbq"));
});

test("a page with no tracking scripts reports no tracking_signals", () => {
  const html = `<!doctype html><html><head><title>Plain page</title></head><body><p>Hi.</p></body></html>`;
  const extraction = extractPage({ html, url: "https://example.com/plain" });

  assert.deepEqual(extraction.tracking_signals, []);
});

test("detectTrackingPixels recognizes GTM independent of extractPage", () => {
  const html = `<script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC123"></script>`;
  assert.deepEqual(detectTrackingPixels(html), ["google_tag_manager"]);
});
