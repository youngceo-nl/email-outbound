# Canonical Lead Pipeline Design

## Goal

Replace the competing legacy profile-processing paths with one observable production flow:

1. Apify discovers usernames from Instagram following lists.
2. Playwright on Steel acquires profile evidence through a fixed Instagram account, Oxylabs IP, and Steel profile.
3. The evidence-first qualification pipeline applies the AI scorecard.
4. Qualified leads enter human review.
5. Approved qualified leads enter enrichment handover.

Apify must not enrich profiles. Instagram account identity must never move to a different proxy or Steel profile.

## Fixed identities

Production uses exactly these active triples:

| Instagram account | Oxylabs endpoint | Expected IP | Steel profile ID |
|---|---|---|---|
| `masakonjoku61` | `disp.oxylabs.io:8001` | `45.155.196.117` | `bf738a3d-4d46-40e4-91d9-6875e331999c` |
| `bethannbuczek1` | `disp.oxylabs.io:8002` | `45.155.196.209` | `73f41a07-06d5-4c0a-a8db-8cc98c51b474` |
| `allinedowho` | `disp.oxylabs.io:8003` | `45.155.198.110` | `6e9e7e59-cb7f-4a62-b60a-31fb4e6555be` |

`jeanettaze`, `ilenekawchpw`, and `livelypageant8` remain stored but paused. Ports 8004 and 8005 remain unassigned. Secrets remain in local and Vercel environment variables, never Git.

## Account selection invariant

`ManagedAccount` gains `steel_profile_id`. An account is eligible for profile acquisition only when it is active and has all three identity fields: cookie, `proxy_url`, and `steel_profile_id`.

The cookie pool must not fall back to a positional proxy pool or global proxy. The acquisition job selects one complete account entry and passes its cookie, proxy URL, username, and Steel profile ID together. A missing field causes a safe skip with an actionable error. It never borrows identity data from another account.

The shared proxy pool remains available only to legacy or logged-out operations while compatibility code is retired. It is not used for authenticated profile acquisition.

## Canonical event flow

Apify following discovery persists newly discovered usernames and emits `lead/profile-acquisition.requested` for those requiring profile evidence.

The acquisition function:

- selects one eligible identity triple;
- opens a Steel Playwright session with the fixed proxy and persistent profile;
- injects only that account's cookie;
- captures profile, recent posts, pinned posts, highlights, external destinations, capture statuses, and diagnostics;
- persists a replayable evidence snapshot and normalized lead metadata;
- emits `lead/qualification.requested` only after a usable acquisition;
- records a terminal acquisition result for blocked, private, missing, or failed profiles.

The qualification function consumes the persisted snapshot. It must not scrape Instagram or silently treat unknown evidence as absent. It runs the evidence-first extractor, deterministic scorecard, and challenger rules. It persists the verdict and routes the lead to `qualified`, `review`, `rejected`, or a retryable data state.

The existing backfill and `crawl/profile.discovered` entry points become thin compatibility adapters that emit the canonical acquisition event. They do not contain their own scraper or scorer.

## Handover

Handover eligibility remains explicit:

- lead status is `qualified`;
- human `review_decision` is `approved`;
- no usable email is already present;
- the lead is not already assigned to an open handover batch.

The pipeline does not bypass human review.

## Challenge quarantine

Any detected Instagram challenge, checkpoint, HTTP 401, or HTTP 403 pauses the exact managed account in shared settings. The current lead is marked retryable and is not retried through a different account or proxy during the same run.

Quarantine writes an error log containing the account label, lead username, proxy host and port, Steel profile ID, session ID, and challenge type. It must never log credentials or cookie values.

The system sends an alert email to `GMAIL_USER` using the configured Gmail transport. Alert delivery is best effort and cannot unpause the account or cause acquisition retries.

## Database changes

Apply `20260801000000_qualification_shadow.sql` and `20260801010000_commercial_qualification.sql` in that order through the Supabase SQL editor. Do not use `supabase db push` while migration history is drifted.

Add only the schema needed by the canonical flow:

- replayable acquisition snapshots and capture status in `lead_evidence_snapshots`;
- qualification history in `lead_commercial_extractions` and `lead_qualification_decisions`;
- current qualification state in the additive projection columns on `leads`;
- canonical qualification controls already defined by the shadow migration.

JSON-managed account fields do not require a table migration. Production settings are updated atomically so all three identity triples and paused states change together.

Shadow qualification starts disabled. After end-to-end verification, enable a small deterministic sample and measure qualification rate and disagreement before cutover.

## Observability

Every lead has correlated stage logs for:

- `following_discovered`;
- `profile_acquisition_started`;
- `profile_acquired` or `profile_acquisition_failed`;
- `qualification_started`;
- `qualified`, `review`, `rejected`, or `data_retry`;
- `handover_ready` after human approval.

Acquisition logs include non-secret identity labels and field completeness. Qualification logs include model version, scorecard version, outcome, certainty, reason codes, and cited source IDs.

The dashboard exposes counts and recent failures per stage so an operator can identify the first broken boundary without reading raw database rows.

## Rollout

1. Add tests for incomplete identity entries, fixed triple selection, and no cross-account fallback.
2. Add tests for acquisition-to-qualification event ordering and unknown evidence handling.
3. Add tests proving a challenge pauses only its account and emits no retry through another identity.
4. Implement the canonical functions and compatibility adapters.
5. Apply the shadow migration and atomic production account mapping.
6. Run one known-good profile through the complete production event path.
7. Verify stage logs, persisted evidence, qualification output, and handover routing.
8. Start warm-up at 20 to 30 acquisitions per active account per day. Increase only after stable operation without challenges.

## Acceptance criteria

- Apify is used only for following-list discovery.
- Every authenticated profile request uses one complete fixed identity triple.
- No cookie, proxy, or Steel profile fallback can cross account boundaries.
- Profile evidence is persisted before qualification begins.
- Qualification uses the evidence-first scorecard and never interprets failed capture as absence.
- Only human-approved qualified leads enter handover.
- A challenge quarantines one account and generates an alert without identity rotation.
- A production canary produces correlated logs across all stages.
- Tests, typecheck, and production build pass before deployment.
