# Range-aware dashboard KPI sheet

_2026-07-31_

## Goal

Make the dashboard's preset and custom date controls govern both the live values
and scaled targets in the Success Metrics KPI sheet.

## Range behavior

The KPI sheet consumes the same resolved range as the pipeline graphic and
other dashboard metrics. Presets cover Today, 7 days, 30 days, 90 days, and All
time. Custom start and end dates are inclusive calendar dates.

All time begins at the earliest recorded activity used by the KPI system and
ends at the current time. If there is no activity, it behaves as a one-day
period so targets remain defined. Range resolution and day counting live in
pure helpers and are shared by KPI fetching and presentation.

## Target scaling

Count targets scale linearly by the inclusive number of selected days:

| KPI | Base target | Scaled target |
|---|---:|---:|
| Leads scraped | 500 daily | `500 x days` |
| Leads enriched | 100 daily | `100 x days` |
| Emails sent | 100 daily | `100 x days` |
| Meetings booked | 30 per 30 days | `days`, equivalent to `30 x days / 30` |

Average and percentage targets do not scale:

- Speed-to-lead remains 30-60 minutes and is on target at 60 minutes or less.
- First response time remains below 2 hours.
- Positive reply rate remains 15 percent.
- Task completion remains 100 percent and is recomputed from the range-aware
  resolved daily KPIs.

Scaled count targets are rounded to whole numbers. With the approved 30-per-30
meeting rule, its scaled target is already one meeting per selected day.

## Live value calculations

Every Supabase KPI query uses the selected start and end timestamps instead of
an internal today boundary. Count metrics aggregate within the range. Timing
metrics average qualifying intervals completed within the range. Positive reply
rate divides positive replies received within the range by emails sent within
the range.

Meetings booked counts rows from the shared Meetings sheet that fall within the
selected date range. The sheet stores Dutch day-month labels without a year, so
the current-year convention remains the source-of-truth convention used by the
existing integration. This is sufficient for the app's current recorded data;
rows without a resolvable date remain excluded.

Source failures keep the existing unavailable behavior and do not crash the
dashboard. A legitimate empty count remains zero.

## Presentation

The table's live-value column no longer says Today unconditionally. It shows the
active period label:

- Today
- 7 days
- 30 days
- 90 days
- All time
- `start date - end date` for a custom range

The card description also references the selected period. Frequency labels
continue to describe the base operating cadence, while the Target column shows
the scaled target. Existing placement, status badges, typography, and horizontal
overflow behavior remain unchanged.

## Components and data flow

- `lib/date-range.ts` exposes inclusive day counting and a display label for a
  resolved range.
- `lib/kpi.ts` accepts the resolved timestamp range and day count, applies those
  bounds to Supabase queries, and scales count targets.
- `lib/kpi-meetings.ts` accepts the selected range and counts matching sheet
  rows.
- `app/(dashboard)/page.tsx` passes one resolved range through the KPI loaders
  and then passes the range label to `KpiTable`.
- `components/dashboard/kpi-table.tsx` renders the dynamic period label without
  performing data fetching.

## Verification

Unit tests cover inclusive day counts, preset and custom labels, count-target
scaling, unchanged time/rate targets, range-bounded meeting counting, and All
time fallback behavior. Existing KPI tests remain green. Type checking and lint
must pass without new errors. Browser verification checks Today, 7 days, 30
days, 90 days, All time, and one custom range, confirming both the table label
and representative scaled targets update after navigation.
