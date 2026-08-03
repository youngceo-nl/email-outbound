import assert from "node:assert/strict";
import test from "node:test";
import type { ScrapedProfile } from "@/lib/types";
import { buildProfileAcquisitionEvents } from "./canonical-events";
import { chunk, partitionByBioLink, type PrefilterLead } from "./prefilter";

// ---- Fixtures ----

function lead(username: string): PrefilterLead {
  return { id: `id-${username}`, username };
}

function profile(overrides: Partial<ScrapedProfile> & { username: string }): ScrapedProfile {
  return {
    full_name: "Test Person",
    profile_url: `https://www.instagram.com/${overrides.username}/`,
    profile_pic_url: null,
    bio: "coach",
    external_link: null,
    followers: 10_000,
    following: 500,
    posts: 200,
    is_private: false,
    is_verified: false,
    recent_posts: [],
    ...overrides,
  };
}

// ---- The skip decision ----

test("a profile Apify returned with no bio link is skipped", () => {
  const leads = [lead("angad1k")];
  const { acquire, skipped } = partitionByBioLink(
    leads,
    [profile({ username: "angad1k", external_link: null })],
  );

  assert.deepEqual(skipped, leads, "no link means nothing for the funnel crawl to read");
  assert.deepEqual(acquire, []);
});

test("a bio link of only whitespace is treated as absent", () => {
  const { acquire, skipped } = partitionByBioLink(
    [lead("armaniftl")],
    [profile({ username: "armaniftl", external_link: "   " })],
  );

  assert.equal(skipped.length, 1, "a blank string is not a link");
  assert.equal(acquire.length, 0);
});

test("a profile with a bio link goes on to acquisition", () => {
  const { acquire, skipped } = partitionByBioLink(
    [lead("byysid")],
    [profile({ username: "byysid", external_link: "https://byysid.com" })],
  );

  assert.equal(acquire.length, 1);
  assert.equal(skipped.length, 0);
});

test("username matching ignores case on both sides", () => {
  const { skipped } = partitionByBioLink(
    [lead("Alix.CEO")],
    [profile({ username: "alix.ceo", external_link: null })],
  );
  assert.equal(skipped.length, 1, "Apify lowercases usernames; the lead list may not");
});

// ---- Failing open: the part that matters ----

test("a lead Apify never returned is acquired, not skipped", () => {
  /*
   * The whole safety property. A username missing from the dataset is unknown —
   * a rate limit, an over-limit token, a profile the actor could not read — and
   * treating unknown as "no link" would silently delete leads whenever Apify had
   * a bad day.
   */
  const { acquire, skipped } = partitionByBioLink(
    [lead("byysid"), lead("nobody-returned-me")],
    [profile({ username: "byysid", external_link: null })],
  );

  assert.deepEqual(
    acquire.map((l) => l.username),
    ["nobody-returned-me"],
    "unknown must get the benefit of the doubt",
  );
  assert.deepEqual(skipped.map((l) => l.username), ["byysid"]);
});

test("a total Apify failure sends every lead to acquisition", () => {
  const leads = [lead("a"), lead("b"), lead("c")];
  const { acquire, skipped } = partitionByBioLink(leads, []);

  assert.equal(acquire.length, 3, "a broken pre-filter costs money, never leads");
  assert.equal(skipped.length, 0);
});

test("an empty lead list produces no work", () => {
  const { acquire, skipped } = partitionByBioLink([], []);
  assert.deepEqual(acquire, []);
  assert.deepEqual(skipped, []);
});

// ---- Fan-out ----

test("event_index is contiguous across survivors so the identity rota stays even", () => {
  // selectAcquisitionIdentity picks by `event_index % pool.length`, so gaps left
  // by pre-filtered leads would load the surviving accounts unevenly.
  const { acquire } = partitionByBioLink(
    [lead("keep1"), lead("drop1"), lead("keep2"), lead("drop2"), lead("keep3")],
    [
      profile({ username: "keep1", external_link: "https://one.com" }),
      profile({ username: "drop1", external_link: null }),
      profile({ username: "keep2", external_link: "https://two.com" }),
      profile({ username: "drop2", external_link: null }),
      profile({ username: "keep3", external_link: "https://three.com" }),
    ],
  );

  const events = buildProfileAcquisitionEvents(acquire, null, "run-1");
  assert.deepEqual(
    events.map((e) => e.data.event_index),
    [0, 1, 2],
  );
  assert.deepEqual(
    events.map((e) => e.data.username),
    ["keep1", "keep2", "keep3"],
  );
  assert.equal(events.every((e) => e.data.run_id === "run-1"), true);
});

// ---- Batching ----

test("chunk splits a run into whole batches with a short remainder", () => {
  const items = Array.from({ length: 120 }, (_, i) => i);
  const batches = chunk(items, 50);

  assert.deepEqual(batches.map((b) => b.length), [50, 50, 20]);
  assert.equal(batches.flat().length, 120, "chunking must not lose a lead");
  assert.deepEqual(chunk([], 50), [], "no leads means no Apify call");
});
