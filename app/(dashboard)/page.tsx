import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InfoTip } from "@/components/ui/info-tip";
import { ActiveSearches } from "@/components/dashboard/active-searches";
import { Trends } from "@/components/dashboard/trends";
import { DateRangeBar } from "@/components/dashboard/date-range-bar";
import { PipelineFlowCard, type PipelineStep } from "@/components/dashboard/pipeline-flow";
import { KpiTable } from "@/components/dashboard/kpi-table";
import { SeedPipelineList } from "@/components/logs/seed-pipeline-card";
import { PipelineStats } from "@/components/logs/pipeline-stats";
import { formatNumber } from "@/lib/utils";
import { actionLabel, actionIsPositive } from "@/lib/labels";
import { fetchDailyMetrics } from "@/lib/metrics";
import { inclusiveRangeDays, rangeLabel, resolveDateRange, type ResolvedRange } from "@/lib/date-range";
import { assembleKpiRows, fetchDailyKpis } from "@/lib/kpi";
import { fetchMeetingsBooked } from "@/lib/kpi-meetings";
import { getPipelineStats } from "@/app/actions/leads";
import { getSeedPipelines } from "@/app/actions/crawl-jobs";
import { formatDistanceToNow } from "date-fns";
import { Mail, Send, MessageSquareHeart, CalendarCheck } from "lucide-react";

export const dynamic = "force-dynamic";

type CrawlLogRow = {
  id: number;
  profile_username: string;
  action: string;
  depth: number;
  detail: string | null;
  created_at: string;
};

type ActiveJob = {
  id: string;
  status: string;
  current_depth: number;
  max_depth: number;
  profiles_scraped: number;
  qualified_count: number;
  expected_profiles: number | null;
  seeds: { username: string } | null;
};

async function resolveKpiRange(
  sb: ReturnType<typeof createAdminClient>,
  range: ResolvedRange,
): Promise<ResolvedRange> {
  if (range.start && range.end) return range;

  const [scrape, enriched, sent, reply] = await Promise.all([
    sb.from("crawl_logs").select("created_at").order("created_at", { ascending: true }).limit(1),
    sb.from("leads").select("enriched_at").not("enriched_at", "is", null).order("enriched_at", { ascending: true }).limit(1),
    sb.from("outreach_messages").select("sent_at").not("sent_at", "is", null).order("sent_at", { ascending: true }).limit(1),
    sb.from("inbox_messages").select("received_at").order("received_at", { ascending: true }).limit(1),
  ]);

  const candidates = [
    scrape.data?.[0]?.created_at,
    enriched.data?.[0]?.enriched_at,
    sent.data?.[0]?.sent_at,
    reply.data?.[0]?.received_at,
  ].filter((value): value is string => Boolean(value));
  const end = new Date();
  const start = candidates.length
    ? new Date(Math.min(...candidates.map((value) => new Date(value).getTime())))
    : new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return { start, end, preset: "all" };
}

async function loadStats(range: ResolvedRange) {
  const sb = createAdminClient();
  const kpiRange = await resolveKpiRange(sb, range);
  const kpiDays = inclusiveRangeDays(kpiRange);

  // Emails Found: dated by enriched_at (when we found it), matching the
  // metrics_daily migration's own definition of the "emails" metric.
  let emailsFoundQuery = sb.from("leads").select("*", { count: "exact", head: true }).or("email.not.is.null,email_v2.not.is.null");
  if (range.start) emailsFoundQuery = emailsFoundQuery.gte("enriched_at", range.start.toISOString());
  if (range.end) emailsFoundQuery = emailsFoundQuery.lte("enriched_at", range.end.toISOString());

  let emailsSentQuery = sb.from("outreach_messages").select("*", { count: "exact", head: true }).eq("status", "sent");
  if (range.start) emailsSentQuery = emailsSentQuery.gte("sent_at", range.start.toISOString());
  if (range.end) emailsSentQuery = emailsSentQuery.lte("sent_at", range.end.toISOString());

  let positiveRepliesQuery = sb.from("inbox_messages").select("lead_id").eq("sentiment", "positive");
  if (range.start) positiveRepliesQuery = positiveRepliesQuery.gte("received_at", range.start.toISOString());
  if (range.end) positiveRepliesQuery = positiveRepliesQuery.lte("received_at", range.end.toISOString());

  const [
    { count: total },
    { count: qualified },
    { count: review },
    { count: rejected },
    { data: scoreAgg },
    { data: recent },
    { data: activeJobs },
    metrics,
    pipelineStats,
    seedPipelines,
    { count: emailsFound },
    { count: emailsSent },
    { data: positiveReplyRows },
    dailyKpis,
    meetingsBooked,
  ] = await Promise.all([
    sb.from("leads").select("*", { count: "exact", head: true }),
    sb.from("leads").select("*", { count: "exact", head: true }).eq("status", "qualified"),
    sb.from("leads").select("*", { count: "exact", head: true }).eq("status", "review"),
    sb.from("leads").select("*", { count: "exact", head: true }).eq("status", "rejected"),
    sb.from("leads").select("overall_score").not("overall_score", "is", null),
    sb.from("crawl_logs").select("*").order("created_at", { ascending: false }).limit(20),
    sb
      .from("crawl_jobs")
      .select("id, status, current_depth, max_depth, profiles_scraped, qualified_count, expected_profiles, seeds(username)")
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false }),
    fetchDailyMetrics(sb, 30),
    getPipelineStats(),
    // Empty rather than fatal: a missing counters migration must not take the
    // whole Dashboard down.
    getSeedPipelines().catch(() => []),
    emailsFoundQuery,
    emailsSentQuery,
    // Deduped per lead — a lead who replied positively three times is one
    // prospect who said yes, not three (matches the Reports tab's counting).
    positiveRepliesQuery,
    fetchDailyKpis(sb, { start: kpiRange.start!, end: kpiRange.end! }),
    fetchMeetingsBooked({ start: kpiRange.start!, end: kpiRange.end! }),
  ]);

  const scores = (scoreAgg ?? []).map((r) => Number(r.overall_score)).filter((n) => Number.isFinite(n));
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const positiveReplies = new Set((positiveReplyRows ?? []).map((r) => r.lead_id)).size;

  return {
    total: total ?? 0,
    qualified: qualified ?? 0,
    review: review ?? 0,
    rejected: rejected ?? 0,
    avg,
    recent: (recent ?? []) as CrawlLogRow[],
    activeJobs: (activeJobs ?? []) as unknown as ActiveJob[],
    metrics: metrics.rows,
    metricsError: metrics.error,
    pipelineStats,
    seedPipelines,
    emailsFound: emailsFound ?? 0,
    emailsSent: emailsSent ?? 0,
    positiveReplies,
    kpis: assembleKpiRows(dailyKpis, meetingsBooked, kpiDays),
    kpiRangeLabel: rangeLabel(kpiRange),
  };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; start?: string; end?: string }>;
}) {
  const sp = await searchParams;
  const range = resolveDateRange(sp);
  const s = await loadStats(range);

  const iconClass = "h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground/70";
  const pipelineSteps: PipelineStep[] = [
    { key: "emails_found", label: "Emails Found", value: s.emailsFound, icon: <Mail className={iconClass} /> },
    { key: "emails_sent", label: "Emails Sent", value: s.emailsSent, icon: <Send className={iconClass} /> },
    { key: "positive_replies", label: "Positive Replies", value: s.positiveReplies, icon: <MessageSquareHeart className={iconClass} /> },
    { key: "meetings_booked", label: "Meetings Booked", value: null, icon: <CalendarCheck className={iconClass} /> },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">A quick look at what your searches have found.</p>
      </div>

      <div className="space-y-3">
        <DateRangeBar activePreset={range.preset} customStart={sp.start} customEnd={sp.end} />
        <PipelineFlowCard steps={pipelineSteps} />
      </div>

      <Card className="overflow-hidden shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle>Success Metrics (KPIs)</CardTitle>
          <CardDescription>Progress against operating targets for {s.kpiRangeLabel.toLowerCase()}.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <KpiTable rows={s.kpis} periodLabel={s.kpiRangeLabel} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Stat label="Total leads"   value={formatNumber(s.total)} tip="Every potential lead found so far." />
        <Stat label="Qualified"     value={formatNumber(s.qualified)} accent="green" tip="Leads that passed your filters and scored well — your best prospects." />
        <Stat label="Needs review"  value={formatNumber(s.review)} accent="yellow" tip="Borderline leads worth a manual look." />
        <Stat label="Not a fit"     value={formatNumber(s.rejected)} accent="red" tip="Leads that didn't meet your requirements." />
        <Stat label="Avg score"     value={s.avg != null ? s.avg.toFixed(1) : "—"} tip="Average fit score (0–10) across all analyzed leads." />
      </div>

      <ActiveSearches initial={s.activeJobs} />

      <Trends initial={s.metrics} initialError={s.metricsError} />

      <SeedPipelineList initial={s.seedPipelines} />

      <PipelineStats stats={s.pipelineStats} />

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {s.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet. Add a profile to scrape from <Link href="/seeds" className="underline">Add Profiles to Scrape</Link>.</p>
          ) : (
            <ul className="divide-y">
              {s.recent.map((row) => (
                <li key={row.id} className="py-2 flex items-center gap-3 text-sm">
                  <Badge variant={actionIsPositive(row.action) ? "outline" : "secondary"}>{actionLabel(row.action)}</Badge>
                  <span className="font-medium">@{row.profile_username}</span>
                  <span className="text-muted-foreground">{row.depth === 0 ? "starting profile" : `${row.depth} connection${row.depth === 1 ? "" : "s"} away`}</span>
                  {row.detail && <span className="text-muted-foreground truncate flex-1">{row.detail}</span>}
                  <span className="text-muted-foreground ml-auto whitespace-nowrap">
                    {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, accent, tip }: { label: string; value: string; accent?: "green" | "yellow" | "red"; tip?: string }) {
  const accentClass =
    accent === "green" ? "text-green-600" :
    accent === "yellow" ? "text-yellow-600" :
    accent === "red" ? "text-red-600" : "";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
          {label}
          {tip && <InfoTip text={tip} />}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-3xl font-semibold ${accentClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
