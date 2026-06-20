import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InfoTip } from "@/components/ui/info-tip";
import { ActiveSearches } from "@/components/dashboard/active-searches";
import { Trends } from "@/components/dashboard/trends";
import { formatNumber } from "@/lib/utils";
import { actionLabel, actionIsPositive } from "@/lib/labels";
import { fetchDailyMetrics } from "@/lib/metrics";
import { formatDistanceToNow } from "date-fns";

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

async function loadStats() {
  const sb = createAdminClient();
  const [
    { count: total },
    { count: qualified },
    { count: review },
    { count: rejected },
    { data: scoreAgg },
    { data: recent },
    { data: activeJobs },
    metrics,
    { count: readyToSend },
    { count: sentToday },
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
    // Runway: qualified leads with email, not yet contacted, not bounced
    sb.from("leads").select("*", { count: "exact", head: true })
      .eq("status", "qualified")
      .not("email", "is", null)
      .neq("email_status", "bounced")
      .eq("outreach_count", 0),
    // Sent today
    sb.from("outreach_messages").select("*", { count: "exact", head: true })
      .eq("status", "sent")
      .gte("sent_at", new Date(new Date().setHours(0,0,0,0)).toISOString()),
  ]);

  const scores = (scoreAgg ?? []).map((r) => Number(r.overall_score)).filter((n) => Number.isFinite(n));
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

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
    readyToSend: readyToSend ?? 0,
    sentToday: sentToday ?? 0,
  };
}

export default async function DashboardPage() {
  const s = await loadStats();
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">A quick look at what your searches have found.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Stat label="Total leads"   value={formatNumber(s.total)} tip="Every potential lead found so far." />
        <Stat label="Qualified"     value={formatNumber(s.qualified)} accent="green" tip="Leads that passed your filters and scored well — your best prospects." />
        <Stat label="Needs review"  value={formatNumber(s.review)} accent="yellow" tip="Borderline leads worth a manual look." />
        <Stat label="Not a fit"     value={formatNumber(s.rejected)} accent="red" tip="Leads that didn't meet your requirements." />
        <Stat label="Avg score"     value={s.avg != null ? s.avg.toFixed(1) : "—"} tip="Average fit score (0–10) across all analyzed leads." />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Stat
          label="Ready to send"
          value={formatNumber(s.readyToSend)}
          accent={s.readyToSend < 25 ? "red" : s.readyToSend < 50 ? "yellow" : "green"}
          tip="Qualified leads with a confirmed email that haven't been contacted yet. Target: ≥25."
        />
        <Stat
          label="Sent today"
          value={`${s.sentToday} / 25`}
          accent={s.sentToday >= 25 ? "green" : undefined}
          tip="Outreach emails sent today toward the daily target of 25."
        />
        <Stat
          label="Pipeline runway"
          value={s.readyToSend < 25 ? "⚠ Low" : `~${Math.floor(s.readyToSend / 25)}d`}
          accent={s.readyToSend < 25 ? "red" : "green"}
          tip="How many days of sending at 25/day before you run out of leads with emails."
        />
      </div>

      <ActiveSearches initial={s.activeJobs} />

      <Trends initial={s.metrics} initialError={s.metricsError} />

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {s.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet. Start a search from <Link href="/seeds" className="underline">Source Accounts</Link>.</p>
          ) : (
            <ul className="divide-y">
              {s.recent.map((row) => (
                <li key={row.id} className="py-2 flex items-center gap-3 text-sm">
                  <Badge variant={actionIsPositive(row.action) ? "outline" : "secondary"}>{actionLabel(row.action)}</Badge>
                  <span className="font-medium">@{row.profile_username}</span>
                  <span className="text-muted-foreground">level {row.depth}</span>
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
