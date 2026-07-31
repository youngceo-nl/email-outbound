# Success Metrics KPI sheet on the main dashboard

_2026-07-31_

## Goal

Add a full-width "Success Metrics (KPIs)" sheet directly below the main
pipeline graphic on the leads-scraper-ig dashboard. The sheet compares each
target with the current value for its stated period and makes missed targets
easy to scan without competing with the pipeline.

## Layout

Render one restrained dashboard card with five columns:

| KPI | Target | Frequency | Today | Status |
|---|---:|---|---:|---|

"Today" is the live-value column requested by the user. The Meetings booked
row labels its live value "This month" because its target is monthly. The card
uses the dashboard's existing typography, borders, spacing, and color tokens.
Status appears as a compact badge: green "On track", red "Below target", or
gray "Not connected". On narrow screens the table scrolls horizontally rather
than compressing labels into unreadable columns.

## KPI definitions and sources

| KPI | Target | Frequency | Live-value definition |
|---|---:|---|---|
| Leads scraped | 500 | Daily | Count of scrape events created today |
| Leads enriched | 100 | Daily | Count of leads enriched with an email today |
| Emails sent | 100 | Daily | Count of outreach messages sent today |
| Speed-to-lead | 30-60 min | Per lead | Average time from receiving a positive prospect reply to sending our first response, for responses sent today |
| First response time | < 2 hours | Daily | Average time from the initial outbound email to the prospect's first reply, for replies received today |
| Positive reply rate | 15% | Daily | Positive replies received today divided by emails sent today |
| Meetings booked | 30 | Monthly | Meetings in the current calendar month from the configured shared Meetings sheet |
| Task completion | 100% | Daily | Percentage of resolved daily KPI rows currently on target |

Speed-to-lead is on target at 60 minutes or faster. Responses under 30 minutes
remain on target. First response time is kept distinct from speed-to-lead: the
former measures prospect responsiveness, while the latter measures the team's
follow-up speed after a positive reply.

Daily values use UTC midnight-to-midnight, matching the app's existing daily
email counter. Meetings uses the current calendar month. The dashboard's date
range control does not change these fixed KPI periods.

## Data flow

- `lib/kpi.ts` owns KPI types, target comparisons, fixed-period Supabase
  queries, rate calculations, timing calculations, and task completion.
- `lib/kpi-meetings.ts` reads the existing shared Google Meetings sheet and
  returns the current month's count. Missing configuration or a Sheets failure
  returns an unavailable value rather than failing the dashboard.
- `components/dashboard/kpi-table.tsx` remains presentational and receives the
  assembled rows as props.
- `app/(dashboard)/page.tsx` fetches the KPI snapshot with the rest of the
  dashboard data and renders the card immediately after `PipelineFlowCard`.

The timing queries use the existing `inbox_messages.received_at`,
`inbox_messages.replied_at`, and related `outreach_messages.sent_at` fields.
Only the first qualifying inbound reply and first team response are counted per
lead or conversation, avoiding duplicate-message inflation.

## Missing data and status rules

- A source failure or missing timestamp produces an unavailable metric, shown
  as an em dash with "Not connected". It must not appear as zero.
- A legitimate empty count appears as `0` and receives the normal target
  status.
- Positive reply rate is unavailable when no emails were sent today, because
  the denominator is zero.
- Timing KPIs are unavailable when there are no qualifying completed intervals
  in the period.
- Task completion excludes unavailable daily KPIs from both numerator and
  denominator. It is unavailable when none of its inputs resolve.
- Meetings booked is evaluated against its monthly target and excluded from the
  daily task-completion calculation.

## Verification

Unit tests cover target comparisons, timing calculations, zero denominators,
row ordering, unavailable inputs, and task completion. Type checking and lint
must pass. Browser verification covers the final placement below the pipeline,
all eight rows, live values, status badges, desktop layout, mobile overflow,
and the dashboard remaining usable when Google Sheets is not configured.
