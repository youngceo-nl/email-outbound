"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { LiveStatus } from "@/components/ui/live-status";
import { formatDistanceToNow } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { cancelCrawl, retryCrawl } from "@/app/actions/crawl-jobs";
import { actionLabel, actionIsPositive, statusLabel } from "@/lib/labels";
import { X, RotateCw } from "lucide-react";

type Job = {
  id: string;
  status: string;
  max_depth: number;
  current_depth: number;
  profiles_scraped: number;
  qualified_count: number;
  rejected_count: number;
  expected_profiles: number | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  seeds: { username: string } | null;
};

type CrawlLog = {
  id: string;
  action: string;
  profile_username: string;
  parent_username: string | null;
  depth: number;
  detail: string | null;
  status: string | null;
  created_at: string;
};

type ErrorLog = {
  id: string;
  context: string;
  error_message: string;
  created_at: string;
};

type LeadRow = {
  id: string;
  username: string;
  status: string;
  overall_score: number | null;
  niche: string | null;
  crawl_depth: number;
  parent_username: string | null;
  created_at: string;
};

const ACTIVE = new Set(["queued", "running"]);

export function JobDetailLive({
  jobId,
  seedId,
  jobCreatedAt,
  initialJob,
  initialEvents,
  initialErrors,
  initialLeads,
}: {
  jobId: string;
  seedId: string;
  jobCreatedAt: string;
  initialJob: Job;
  initialEvents: CrawlLog[];
  initialErrors: ErrorLog[];
  initialLeads: LeadRow[];
}) {
  const [job, setJob] = useState<Job>(initialJob);
  const [events, setEvents] = useState<CrawlLog[]>(initialEvents);
  const [errors, setErrors] = useState<ErrorLog[]>(initialErrors);
  const [leads, setLeads] = useState<LeadRow[]>(initialLeads);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const active = ACTIVE.has(job.status);

  useEffect(() => {
    const sb = createClient();
    let cancelled = false;

    const tick = async () => {
      const [j, e, er, l] = await Promise.all([
        sb.from("crawl_jobs").select("*, seeds(username)").eq("id", jobId).single(),
        sb.from("crawl_logs").select("*").eq("crawl_job_id", jobId).order("created_at", { ascending: false }).limit(300),
        sb.from("error_logs").select("*").eq("crawl_job_id", jobId).order("created_at", { ascending: false }).limit(50),
        sb
          .from("leads")
          .select("id, username, status, overall_score, niche, crawl_depth, parent_username, created_at")
          .eq("source_seed_id", seedId)
          .gte("created_at", jobCreatedAt)
          .order("overall_score", { ascending: false, nullsFirst: false })
          .limit(100),
      ]);
      if (cancelled) return;
      if (j.data) setJob(j.data as Job);
      if (e.data) setEvents(e.data as CrawlLog[]);
      if (er.data) setErrors(er.data as ErrorLog[]);
      if (l.data) setLeads(l.data as LeadRow[]);
    };

    const interval = active ? 2500 : 10000;
    const id = setInterval(tick, interval);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [jobId, seedId, jobCreatedAt, active]);

  const expected = job.expected_profiles ?? 0;
  const scraped = job.profiles_scraped ?? 0;
  const pct = expected > 0 ? Math.min(100, Math.round((scraped / expected) * 100)) : null;
  const canCancel = job.status === "running" || job.status === "queued";
  const canRetry = job.status === "failed" || job.status === "cancelled";

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 flex-wrap">
              <CardTitle className="text-base">Status</CardTitle>
              <Badge variant={badgeVariant(job.status)}>{statusLabel(job.status)}</Badge>
              <span className="text-xs text-muted-foreground">level {job.current_depth} of {job.max_depth}</span>
              <LiveStatus active={active} />
            </div>
            <div className="flex items-center gap-1.5">
              {canCancel && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await cancelCrawl(job.id);
                      setMsg("error" in res && res.error ? `Error: ${res.error}` : "Stopping…");
                    })
                  }
                >
                  <X className="h-3.5 w-3.5 mr-1" /> Stop
                </Button>
              )}
              {canRetry && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await retryCrawl(job.id);
                      setMsg("error" in res && res.error ? `Error: ${res.error}` : "Search restarted.");
                    })
                  }
                >
                  <RotateCw className="h-3.5 w-3.5 mr-1" /> Try again
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <Stat label="Accounts checked" value={`${scraped}${expected > 0 ? ` / ${expected}` : ""}`} />
            <Stat label="Qualified" value={String(job.qualified_count)} accent="text-green-600" />
            <Stat label="Not a fit" value={String(job.rejected_count)} accent="text-red-600" />
            <Stat
              label="Started"
              value={job.started_at ? formatDistanceToNow(new Date(job.started_at), { addSuffix: true }) : "—"}
            />
          </div>
          {(pct != null || job.status === "running") && (
            <div className="space-y-1">
              <Progress
                value={pct}
                state={job.status === "running" ? "running" : job.status === "completed" ? "done" : "idle"}
              />
              <p className="text-xs text-muted-foreground tabular-nums">
                {pct != null ? `${pct}% — ${scraped} of ${expected} accounts checked` : "Working…"}
              </p>
            </div>
          )}
          {job.error_message && (
            <p className="text-xs text-destructive whitespace-pre-wrap">{job.error_message}</p>
          )}
          {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
        </CardContent>
      </Card>

      {errors.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Problems ({errors.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Where</TableHead><TableHead>What happened</TableHead><TableHead>When</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {errors.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell><Badge variant="outline">{e.context}</Badge></TableCell>
                    <TableCell className="text-xs font-mono">{e.error_message}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Activity ({events.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {events.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Nothing yet — activity will appear here as the search runs.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>What happened</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell><Badge variant={actionIsPositive(row.action) ? "outline" : "secondary"}>{actionLabel(row.action)}</Badge></TableCell>
                    <TableCell>@{row.profile_username}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.depth}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.detail}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Leads found ({leads.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {leads.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No leads found from this search yet.</p>
          ) : (
            <ul className="divide-y">
              {leads.map((l) => (
                <li key={l.id} className="px-6 py-2.5 flex items-center gap-3 text-sm">
                  <Link href={`/leads/${l.username}`} className="font-medium hover:underline w-48 truncate">
                    @{l.username}
                  </Link>
                  <Badge variant={leadStatusVariant(l.status)}>{statusLabel(l.status)}</Badge>
                  <span className="text-xs text-muted-foreground w-32 truncate">{l.niche ?? "—"}</span>
                  <span className="text-xs text-muted-foreground tabular-nums w-12">
                    {l.overall_score != null ? Number(l.overall_score).toFixed(1) : "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">level {l.crawl_depth}</span>
                  {l.parent_username && (
                    <span className="text-xs text-muted-foreground truncate">via @{l.parent_username}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${accent ?? ""}`}>{value}</div>
    </div>
  );
}

function badgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "running") return "default";
  if (status === "completed") return "secondary";
  if (status === "failed" || status === "cancelled") return "destructive";
  return "outline";
}

function leadStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "qualified") return "default";
  if (status === "review") return "secondary";
  if (status === "rejected") return "destructive";
  return "outline";
}
