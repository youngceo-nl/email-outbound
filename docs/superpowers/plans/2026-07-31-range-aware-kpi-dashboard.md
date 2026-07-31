# Range-aware KPI Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard date controls filter KPI actuals and proportionally scale count targets.

**Architecture:** Date-range helpers calculate inclusive days and labels. KPI loaders consume a resolved range, scale count targets, and query Supabase and Google Sheets within those bounds. The table receives the active range label as presentation data.

**Tech Stack:** Next.js 15, TypeScript, Supabase, Google Sheets API, Tailwind CSS, node:test.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-31-range-aware-kpi-dashboard-design.md`.
- Daily count targets multiply by inclusive selected days.
- Meetings target is one per selected day.
- Timing and percentage targets do not scale.
- All time begins at earliest KPI activity, falling back to one day when empty.
- Preserve unavailable-source behavior and unrelated workspace changes.

---

### Task 1: Range helpers and target scaling

**Files:**
- Modify: `lib/date-range.ts`
- Create: `lib/date-range.test.ts`
- Modify: `lib/kpi.ts`
- Modify: `lib/kpi.test.ts`

**Interfaces:**
- Produce `inclusiveRangeDays(range): number` and `rangeLabel(range): string`.
- Update `fetchDailyKpis(client, range, days)` to use explicit bounds and scaled count targets.
- Update `assembleKpiRows(daily, meetings, days)` to scale meetings.

- [ ] Write failing tests for inclusive days, labels, scaled count targets, unchanged average targets, and meetings scaling.
- [ ] Run `npx tsx --test lib/date-range.test.ts lib/kpi.test.ts` and confirm expected failures.
- [ ] Implement the pure helpers and scaled target assembly.
- [ ] Re-run the focused tests and confirm they pass.

### Task 2: Range-aware data sources

**Files:**
- Modify: `lib/kpi.ts`
- Modify: `lib/kpi-meetings.ts`
- Modify: `lib/kpi-meetings.test.ts`

**Interfaces:**
- All Supabase KPI queries use the supplied start and end timestamps.
- `countMeetingsInRange(rows, start, end)` counts selected sheet rows.
- `fetchMeetingsBooked(range)` returns a filtered count or null.

- [ ] Write a failing meeting range test spanning matching and nonmatching dates.
- [ ] Run the meeting test and confirm the missing range function fails.
- [ ] Implement selected-range meeting counting and range-aware Supabase bounds.
- [ ] Re-run all KPI tests and confirm they pass.

### Task 3: Dashboard wiring and live verification

**Files:**
- Modify: `app/(dashboard)/page.tsx`
- Modify: `components/dashboard/kpi-table.tsx`

**Interfaces:**
- `loadStats(range)` resolves all-time start when necessary and returns `kpis` plus `kpiRangeLabel`.
- `KpiTable({ rows, periodLabel })` renders the active period as its value-column heading.

- [ ] Pass the resolved range through KPI loaders and render the dynamic label.
- [ ] Run KPI tests, type checking, lint, and the UI detector.
- [ ] Verify Today, 7 days, 30 days, 90 days, All time, and a custom range on localhost.
- [ ] Leave `http://localhost:3417/` open for the user.
