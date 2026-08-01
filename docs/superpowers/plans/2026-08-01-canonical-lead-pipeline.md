# Canonical Lead Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one production path from Apify following discovery through pinned Playwright acquisition and evidence-first qualification to approved enrichment handover.

**Architecture:** A complete managed-account identity is selected as one indivisible cookie, proxy, and Steel-profile tuple. Discovery emits a canonical acquisition event, acquisition persists a replayable evidence snapshot, and qualification consumes that snapshot without scraping. Legacy entry points become adapters to the canonical events.

**Tech Stack:** TypeScript, Next.js 15, Inngest, Supabase, Playwright, Steel SDK, Oxylabs Dedicated ISP proxies, Anthropic SDK, Node test runner through `tsx`.

## Global Constraints

- Apify is used only for following-list discovery.
- Production uses only `masakonjoku61`, `bethannbuczek1`, and `allinedowho` for authenticated acquisition.
- A cookie, proxy URL, and Steel profile ID are fixed as one account identity and never mixed across accounts.
- Failed capture is unknown evidence, never absence.
- Challenges pause only the affected account and never rotate the lead to another identity in the same run.
- Secrets remain in `.env.local`, Vercel encrypted variables, and the server-only shared settings row. They never enter Git.
- Human approval remains required before enrichment handover.
- Do not run `supabase db push` while migration history is drifted.

---

## File Structure

- `lib/instagram/cookie-pool.ts`: select complete, fixed acquisition identities.
- `lib/instagram/cookie-pool.test.ts`: identity invariants and round-robin behavior.
- `lib/instagram/steel-acquisition.ts`: production Steel session and Playwright acquisition boundary.
- `lib/instagram/steel-acquisition.test.ts`: parameter validation and challenge result behavior.
- `lib/instagram/quarantine.ts`: atomic account pause and alert payload construction.
- `lib/instagram/quarantine.test.ts`: exact-account quarantine behavior.
- `lib/outreach/gmail.ts`: existing authenticated Gmail sender reused for alerts.
- `inngest/functions/acquire-profile.ts`: canonical acquisition orchestrator.
- `inngest/functions/qualify-lead.ts`: canonical evidence-first qualification orchestrator.
- `inngest/functions/backfill-metadata.ts`: compatibility adapter only.
- `inngest/functions/process-profile.ts`: compatibility adapter only.
- `inngest/client.ts`: canonical event schemas.
- `app/api/inngest/route.ts`: register canonical functions.
- `lib/qualification/repository.ts`: persist snapshots, extractions, decisions, and lead projection.
- `supabase/migrations/20260801000000_qualification_shadow.sql`: existing shadow controls.
- `supabase/migrations/20260801010000_commercial_qualification.sql`: existing durable evidence and decision history.
- `scripts/configure-production-identities.ts`: atomic production settings update with dry-run default.
- `scripts/audit-canonical-pipeline.ts`: read-only stage audit and canary report.

### Task 1: Enforce Complete Account Identities

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/instagram/cookie-pool.ts`
- Create: `lib/instagram/cookie-pool.test.ts`

**Interfaces:**
- Produces: `ManagedAccount.steel_profile_id?: string | null`
- Produces: `PoolEntry = { cookie: string; proxyUrl: string; accountUsername: string; steelProfileId: string }`
- Produces: `buildAcquisitionPool(settings: AppSettings): PoolEntry[]`
- Consumes: `AppSettings.instagram_accounts`

- [ ] **Step 1: Write failing identity tests**

```ts
test("includes only active accounts with a complete fixed identity", () => {
  const pool = buildAcquisitionPool(settingsWith([
    account("complete", { cookie: "sessionid=a", proxy_url: "http://p1", steel_profile_id: "uuid-1" }),
    account("no-proxy", { cookie: "sessionid=b", steel_profile_id: "uuid-2" }),
    account("paused", { cookie: "sessionid=c", proxy_url: "http://p3", steel_profile_id: "uuid-3", paused: true }),
  ]));
  assert.deepEqual(pool.map(x => x.accountUsername), ["complete"]);
});

test("never borrows a positional or global proxy", () => {
  const pool = buildAcquisitionPool(settingsWith([
    account("incomplete", { cookie: "sessionid=a", steel_profile_id: "uuid-1" }),
  ], { instagram_proxy_pool: ["http://shared"], instagram_proxy_url: "http://global" }));
  assert.equal(pool.length, 0);
});
```

- [ ] **Step 2: Verify RED**

Run: `npx tsx --test lib/instagram/cookie-pool.test.ts`
Expected: FAIL because `buildAcquisitionPool` and `steel_profile_id` do not exist.

- [ ] **Step 3: Implement the strict pool**

Add the optional managed-account field, make `PoolEntry` fields non-null, and implement `buildAcquisitionPool` by filtering active-group accounts for all three trimmed identity values. Keep legacy pool helpers temporarily for logged-out compatibility, but mark them deprecated and remove their use from authenticated acquisition.

- [ ] **Step 4: Verify GREEN**

Run: `npx tsx --test lib/instagram/cookie-pool.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/instagram/cookie-pool.ts lib/instagram/cookie-pool.test.ts
git commit -m "feat: enforce fixed Instagram acquisition identities"
```

### Task 2: Add the Production Steel Acquisition Boundary

**Files:**
- Create: `lib/instagram/steel-acquisition.ts`
- Create: `lib/instagram/steel-acquisition.test.ts`
- Refactor: `scripts/experiments/browser-backend.ts`
- Refactor: `scripts/experiments/playwright-instagram-complete.ts`

**Interfaces:**
- Consumes: `PoolEntry`
- Produces: `acquireInstagramEvidence(input: { username: string; identity: PoolEntry }): Promise<AcquisitionResult>`
- Produces: `AcquisitionResult = { status: "captured" | "blocked" | "challenge" | "failed"; snapshot: EvidenceSnapshot | null; profile: ParsedProfile | null; sessionId: string | null; challenge: string | null; diagnostics: Record<string, unknown> }`

- [ ] **Step 1: Write failing boundary tests**

```ts
test("rejects an incomplete identity before creating a Steel session", async () => {
  await assert.rejects(
    acquireInstagramEvidence({ username: "lead", identity: { cookie: "", proxyUrl: "http://p", accountUsername: "acct", steelProfileId: "uuid" } }),
    /complete acquisition identity/,
  );
});

test("returns challenge without retrying another identity", async () => {
  const result = await classifyAcquisitionOutcome({ challenge: "checkpoint", profile: null });
  assert.equal(result.status, "challenge");
});
```

- [ ] **Step 2: Verify RED**

Run: `npx tsx --test lib/instagram/steel-acquisition.test.ts`
Expected: FAIL because the production boundary does not exist.

- [ ] **Step 3: Extract the proven experiment implementation**

Move reusable Steel session creation, response capture, profile parsing, challenge detection, field-completeness calculation, and snapshot assembly into `lib/instagram/steel-acquisition.ts`. Accept exactly one identity. Set `proxyUrl`, `profileId`, `persistProfile: true`, and `sessionContext.cookies` in the same Steel session call. Always release the paid session in `finally`. Do not write diagnostic HTML or cookie-bearing data.

- [ ] **Step 4: Keep experiments as thin callers**

Update experiment scripts to call the production boundary and retain their summary output. This proves the experiment and production path cannot drift.

- [ ] **Step 5: Verify GREEN and the known-good profile**

Run: `npx tsx --test lib/instagram/steel-acquisition.test.ts`
Expected: all tests pass.

Run the existing `charliewelham_` Steel canary through the approved account-one tuple.
Expected: authenticated, `challenge=none`, profile and recent posts captured, `proxySource=external`.

- [ ] **Step 6: Commit**

```bash
git add lib/instagram/steel-acquisition.ts lib/instagram/steel-acquisition.test.ts scripts/experiments
git commit -m "feat: promote Steel profile acquisition to production"
```

### Task 3: Persist Canonical Evidence and Decisions

**Files:**
- Modify: `lib/qualification/repository.ts`
- Create: `lib/qualification/repository.test.ts`
- Use: `supabase/migrations/20260801000000_qualification_shadow.sql`
- Use: `supabase/migrations/20260801010000_commercial_qualification.sql`

**Interfaces:**
- Produces: `saveEvidenceSnapshot(input): Promise<{ snapshotId: string }>`
- Produces: `saveQualificationRun(input): Promise<{ decisionId: string }>`
- Produces: `projectQualificationToLead(input): Promise<void>`

- [ ] **Step 1: Write failing repository contract tests**

Use an injected repository adapter that records writes. Assert snapshot insert precedes extraction and decision inserts, and lead projection happens last. Assert `data_retry` never sets legacy `status` to `rejected`.

- [ ] **Step 2: Verify RED**

Run: `npx tsx --test lib/qualification/repository.test.ts`
Expected: FAIL because the persistence functions are absent.

- [ ] **Step 3: Implement ordered persistence**

Insert immutable rows into `lead_evidence_snapshots`, `lead_commercial_extractions`, and `lead_qualification_decisions`. Update only the qualification projection columns on `leads` after all history inserts succeed. Map `qualified`, `review`, and `rejected` to the operational `status`; leave retryable acquisition failures pending.

- [ ] **Step 4: Verify GREEN**

Run: `npx tsx --test lib/qualification/repository.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/qualification/repository.ts lib/qualification/repository.test.ts
git commit -m "feat: persist evidence-first qualification history"
```

### Task 4: Build Canonical Inngest Orchestration

**Files:**
- Modify: `inngest/client.ts`
- Create: `inngest/functions/acquire-profile.ts`
- Create: `inngest/functions/acquire-profile.test.ts`
- Create: `inngest/functions/qualify-lead.ts`
- Create: `inngest/functions/qualify-lead.test.ts`
- Modify: `app/api/inngest/route.ts`

**Interfaces:**
- Event: `lead/profile-acquisition.requested` with `{ lead_id, username, crawl_job_id?, event_index? }`
- Event: `lead/qualification.requested` with `{ lead_id, evidence_snapshot_id, crawl_job_id? }`
- Consumes: Task 1 pool, Task 2 acquisition, Task 3 repository

- [ ] **Step 1: Write failing orchestration tests**

Assert a captured acquisition persists the snapshot before emitting qualification. Assert failed or challenged acquisition emits no qualification event. Assert qualification loads the persisted snapshot and does not call an Instagram adapter.

- [ ] **Step 2: Verify RED**

Run: `npx tsx --test inngest/functions/acquire-profile.test.ts inngest/functions/qualify-lead.test.ts`
Expected: FAIL because canonical functions and events are absent.

- [ ] **Step 3: Implement acquisition function**

Use global concurrency 1 during warm-up. Select the deterministic identity by `event_index % pool.length`. Log `profile_acquisition_started`, then `profile_acquired` or `profile_acquisition_failed`, including account label, proxy host and port, Steel profile ID, completeness counts, and session ID. Never include credentials.

- [ ] **Step 4: Implement qualification function**

Load `lead_evidence_snapshots.payload`, call `runCommercialQualification` with the configured Anthropic client and challenger, persist through Task 3, and log the final reason codes and version chain. Do not invoke `instagramEvidenceFromLead` or any scraper.

- [ ] **Step 5: Register functions and verify GREEN**

Run: `npx tsx --test inngest/functions/acquire-profile.test.ts inngest/functions/qualify-lead.test.ts`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add inngest/client.ts inngest/functions/acquire-profile.ts inngest/functions/acquire-profile.test.ts inngest/functions/qualify-lead.ts inngest/functions/qualify-lead.test.ts app/api/inngest/route.ts
git commit -m "feat: add canonical acquisition and qualification events"
```

### Task 5: Convert Legacy Paths into Adapters

**Files:**
- Modify: `inngest/functions/crawl-seed.ts`
- Modify: `inngest/functions/backfill-metadata.ts`
- Modify: `inngest/functions/process-profile.ts`
- Modify: `app/actions/leads.ts`
- Create: `inngest/functions/legacy-adapters.test.ts`

**Interfaces:**
- Consumes: `lead/profile-acquisition.requested`
- Removes production calls to `scrapeProfiles` for profile enrichment and `scoreProfileRouted` from legacy handlers.

- [ ] **Step 1: Write failing adapter tests**

Assert following discovery emits acquisition events for persisted leads. Assert legacy backfill batches resolve lead IDs and emit the same canonical events. Assert `process-profile` emits acquisition and performs no direct scrape or score.

- [ ] **Step 2: Verify RED**

Run: `npx tsx --test inngest/functions/legacy-adapters.test.ts`
Expected: FAIL because legacy handlers still own scraping or scoring.

- [ ] **Step 3: Replace legacy implementations with adapters**

Keep existing public actions and event names so dashboard buttons remain compatible. Each handler resolves leads, emits canonical acquisition events, records adapter counts, and returns. Remove the Apify profile fallback and independent proxy rotation from authenticated enrichment.

- [ ] **Step 4: Verify GREEN**

Run: `npx tsx --test inngest/functions/legacy-adapters.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add inngest/functions/crawl-seed.ts inngest/functions/backfill-metadata.ts inngest/functions/process-profile.ts app/actions/leads.ts inngest/functions/legacy-adapters.test.ts
git commit -m "refactor: route legacy profile work through canonical acquisition"
```

### Task 6: Quarantine Challenges and Alert the Operator

**Files:**
- Create: `lib/instagram/quarantine.ts`
- Create: `lib/instagram/quarantine.test.ts`
- Modify: `inngest/functions/acquire-profile.ts`
- Reuse: `sendEmail` and `gmailReady` from `lib/outreach/gmail.ts`.

**Interfaces:**
- Produces: `quarantineAccount(input: { accountUsername: string; leadUsername: string; proxyUrl: string; steelProfileId: string; sessionId: string | null; challenge: string }): Promise<void>`

- [ ] **Step 1: Write failing quarantine tests**

Assert only the matching account receives `paused: true`; other JSON entries remain byte-for-byte equivalent. Assert the error payload redacts proxy credentials. Assert email failure is recorded but does not undo the pause or enqueue a retry.

- [ ] **Step 2: Verify RED**

Run: `npx tsx --test lib/instagram/quarantine.test.ts`
Expected: FAIL because quarantine does not exist.

- [ ] **Step 3: Implement atomic pause and best-effort email**

Read the settings row, replace only the matching account, and update the full `instagram_accounts` array with optimistic `updated_at` protection. Log the sanitized incident. Call `sendEmail` with `to: settings.gmail_oauth_email || process.env.GMAIL_USER`, subject `Instagram account quarantined: <label>`, and a body containing the account label, target username, endpoint host and port, Steel profile ID, session ID, and challenge type.

- [ ] **Step 4: Wire challenge outcomes**

Call quarantine once for challenge, checkpoint, 401, or 403. Mark the acquisition retryable and return without selecting another pool entry.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npx tsx --test lib/instagram/quarantine.test.ts inngest/functions/acquire-profile.test.ts`
Expected: all tests pass.

```bash
git add lib/instagram/quarantine.ts lib/instagram/quarantine.test.ts inngest/functions/acquire-profile.ts
git commit -m "feat: quarantine challenged Instagram accounts"
```

### Task 7: Configure Production and Add a Stage Audit

**Files:**
- Create: `scripts/configure-production-identities.ts`
- Create: `scripts/audit-canonical-pipeline.ts`
- Modify: `tsconfig.scripts.json`

**Interfaces:**
- Configuration script reads `OXYLABS_PROXY_1..3`, maps the three approved accounts and Steel UUIDs, pauses every other active-group account, and defaults to dry run.
- Audit script prints discovery, acquisition, qualification, and handover counts for a supplied time window and exits nonzero when a stage has input but no downstream output.

- [ ] **Step 1: Write pure mapping tests**

Extract and test `buildProductionIdentityUpdate(settings, env)`. Assert exact mappings, paused states, empty authenticated shared pool, and refusal when any required credential or cookie is missing.

- [ ] **Step 2: Verify RED, implement, and verify GREEN**

Run the new mapping test and confirm it fails before implementation, then passes after the minimal implementation.

- [ ] **Step 3: Dry-run production configuration**

Run: `npx tsx --tsconfig tsconfig.scripts.json --env-file-if-exists=.env.local scripts/configure-production-identities.ts`
Expected: three complete active identities, three paused accounts, no write.

- [ ] **Step 4: Apply atomically and re-read**

Run the same command with `--apply`. Re-read shared settings and verify all three tuples and paused states without printing cookies or credentials.

- [ ] **Step 5: Apply migrations safely**

Paste `20260801000000_qualification_shadow.sql` and then `20260801010000_commercial_qualification.sql` into the Supabase SQL editor. Verify each new table and projection column through read-only REST queries. Leave shadow mode disabled.

- [ ] **Step 6: Commit scripts**

```bash
git add scripts/configure-production-identities.ts scripts/audit-canonical-pipeline.ts tsconfig.scripts.json
git commit -m "chore: configure and audit canonical lead pipeline"
```

### Task 8: Verify, Deploy, and Run One Canary

**Files:**
- Modify only if verification exposes a specific defect.

**Interfaces:**
- Consumes all prior tasks.

- [ ] **Step 1: Run full automated verification**

Run: `npm run typecheck`
Expected: exit 0.

Run: `npx tsx --test $(rg --files -g '*.test.ts' | sort)`
Expected: zero failures.

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 2: Deploy production**

Publish the required Vercel encrypted variables and deploy the verified commit. Confirm the production alias resolves to the new deployment.

- [ ] **Step 3: Send one production canary**

Choose one known-good lead and emit `lead/profile-acquisition.requested` with `event_index: 0`. Do not fan out a batch.

- [ ] **Step 4: Verify every boundary**

Run `scripts/audit-canonical-pipeline.ts --since <canary-start> --username <username>`. Require one acquisition start, one captured snapshot, one qualification decision, no challenge, and a final operational status. If qualified, confirm it appears in review but not handover until manually approved.

- [ ] **Step 5: Start warm-up**

Set production acquisition concurrency to one and cap scheduled/manual batches at 20 to 30 profiles per active account per day. Increase only after three to four challenge-free days on the new IPs.

- [ ] **Step 6: Commit any verification-only correction, then push with explicit approval**

Do not commit generated evidence or secrets. Push the verified commits to `main` only after branch-specific user approval.
