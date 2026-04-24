"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { LiveStatus } from "@/components/ui/live-status";
import { createClient } from "@/lib/supabase/client";

type Row = {
  id: string;
  status: string;
  current_depth: number;
  max_depth: number;
  profiles_scraped: number;
  qualified_count: number;
  expected_profiles: number | null;
  seeds: { username: string } | null;
};

const ACTIVE = new Set(["queued", "running"]);

// Live "what's happening right now" card for the dashboard. Polls the active
// searches so the user always sees current progress without refreshing.
export function ActiveSearches({ initial }: { initial: Row[] }) {
  const [jobs, setJobs] = useState<Row[]>(initial);
  const active = jobs.filter((j) => ACTIVE.has(j.status));
  const hasActive = active.length > 0;

  useEffect(() => {
    const sb = createClient();
    let cancelled = false;
    const tick = async () => {
      const { data } = await sb
        .from("crawl_jobs")
        .select("id, status, current_depth, max_depth, profiles_scraped, qualified_count, expected_profiles, seeds(username)")
        .in("status", ["queued", "running"])
        .order("created_at", { ascending: false });
      if (!cancelled && data) setJobs(data as unknown as Row[]);
    };
    const id = setInterval(tick, hasActive ? 2500 : 10000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [hasActive]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>
          {hasActive ? `Searching now (${active.length})` : "Searches"}
        </CardTitle>
        <LiveStatus active={hasActive} />
      </CardHeader>
      <CardContent>
        {!hasActive ? (
          <p className="text-sm text-muted-foreground">
            Nothing running right now. Start a search from{" "}
            <Link href="/seeds" className="underline">Source Accounts</Link>.
          </p>
        ) : (
          <ul className="space-y-3">
            {active.map((j) => {
              const expected = j.expected_profiles ?? 0;
              const scraped = j.profiles_scraped ?? 0;
              const pct = expected > 0 ? Math.min(100, Math.round((scraped / expected) * 100)) : null;
              return (
                <li key={j.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <Link href={`/seeds/jobs/${j.id}`} className="font-medium hover:underline">
                      @{j.seeds?.username ?? "—"}
                    </Link>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {scraped}{expected > 0 ? ` / ${expected}` : ""} checked · {j.qualified_count} qualified
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Progress value={pct} state="running" size="sm" />
                    {pct != null && (
                      <span className="text-[11px] text-muted-foreground tabular-nums w-9 text-right">{pct}%</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
