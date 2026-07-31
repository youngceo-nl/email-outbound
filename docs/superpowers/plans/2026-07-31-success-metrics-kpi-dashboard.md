# Success Metrics KPI Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an eight-row Success Metrics KPI table directly below the main dashboard pipeline with live daily and monthly values.

**Architecture:** Pure KPI calculations and row assembly live in `lib/kpi.ts`; Google Sheets month counting remains isolated in `lib/kpi-meetings.ts`. The server dashboard loads the snapshot and passes it to a presentational table component that follows the incumbent dashboard design.

**Tech Stack:** Next.js 15 App Router, React, TypeScript, Supabase, Google APIs, Tailwind CSS, node:test.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-31-success-metrics-kpi-dashboard-design.md`.
- Render directly below `PipelineFlowCard`.
- Include all eight requested KPI rows.
- Use UTC boundaries for daily metrics and the current month for meetings.
- Speed-to-lead measures positive reply receipt to first team response and is on target at 60 minutes or faster.
- First response time measures initial outbound email to the prospect's first reply and is on target below 2 hours.
- Source failures and missing intervals display as unavailable, never as zero.
- Preserve unrelated user changes in the dirty worktree.

---

### Task 1: Complete KPI calculation contracts

**Files:**
- Modify: `lib/kpi.ts`
- Modify: `lib/kpi.test.ts`

**Interfaces:**
- Produce `averageDurationMinutes(intervals)` for valid timestamp intervals.
- Produce `fetchDailyKpis(client): Promise<KpiRow[]>` in this order: leads scraped, leads enriched, emails sent, speed-to-lead, first response time, positive reply rate.
- Produce `assembleKpiRows(daily, meetings): KpiRow[]` with meetings and task completion appended.

- [ ] **Step 1: Write failing tests** for valid interval averaging, invalid and negative interval rejection, the 60-minute speed target, eight-row ordering, and task completion excluding unavailable rows.
- [ ] **Step 2: Run `npx tsx --test lib/kpi.test.ts`** and confirm the new assertions fail for missing behavior.
- [ ] **Step 3: Implement the calculations and row definitions** using `inbox_messages.received_at`, `inbox_messages.replied_at`, and joined `outreach_messages.sent_at`. Deduplicate timing samples by conversation or lead before averaging.
- [ ] **Step 4: Run `npx tsx --test lib/kpi.test.ts`** and confirm all tests pass.

### Task 2: Preserve monthly meetings behavior

**Files:**
- Verify: `lib/kpi-meetings.ts`
- Verify: `lib/kpi-meetings.test.ts`

**Interfaces:**
- Consume `fetchMeetingsBookedThisMonth(): Promise<number | null>`.

- [ ] **Step 1: Run `npx tsx --test lib/kpi-meetings.test.ts`** to establish existing month parsing and counting behavior.
- [ ] **Step 2: Make only compatibility changes required by the eight-row assembly**, keeping missing configuration non-fatal.
- [ ] **Step 3: Re-run the meetings tests** and confirm they pass.

### Task 3: Render the KPI sheet

**Files:**
- Modify: `components/dashboard/kpi-table.tsx`
- Modify: `app/(dashboard)/page.tsx`

**Interfaces:**
- `KpiTable({ rows }: { rows: KpiRow[] })` renders KPI, Target, Frequency, Today, and Status.
- `loadStats()` returns assembled `kpis` without allowing a KPI source failure to crash the dashboard.

- [ ] **Step 1: Load the incumbent dashboard design context and craft-floor instructions** before editing UI.
- [ ] **Step 2: Wire the KPI snapshot into `loadStats()`** and render a titled full-width card immediately after `PipelineFlowCard`.
- [ ] **Step 3: Update table copy and formatting** for all eight rows, per-lead frequency, today versus this-month values, unavailable values, status badges, and mobile horizontal scrolling.
- [ ] **Step 4: Run the focused KPI tests** and confirm they pass.

### Task 4: Verify the finished dashboard

**Files:**
- Verify: `app/(dashboard)/page.tsx`
- Verify: `components/dashboard/kpi-table.tsx`
- Verify: `lib/kpi.ts`

- [ ] **Step 1: Run `npm run typecheck`.** Expected: exit 0.
- [ ] **Step 2: Run `npm run lint`.** Expected: exit 0, or document pre-existing findings separately from new findings.
- [ ] **Step 3: Inspect the running dashboard at `http://localhost:3417/`** at desktop and narrow viewport widths.
- [ ] **Step 4: Fix all defects found in one bounded batch** and perform one final confirmation pass.
- [ ] **Step 5: Review the final diff** to confirm only KPI feature files and its approved documentation changed.
