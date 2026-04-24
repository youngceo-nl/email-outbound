import { getBillingSummary, type SpendKind } from "@/lib/billing/summary";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshButton } from "@/components/billing/refresh-button";
import { SpendChart } from "@/components/billing/spend-chart";
import { FixedCostsEditor } from "@/components/billing/fixed-costs-editor";
import { formatDistanceToNow } from "date-fns";

export const dynamic = "force-dynamic";

function usd(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const KIND_BADGE: Record<SpendKind, { label: string; variant: "default" | "secondary" | "outline" }> = {
  metered: { label: "metered", variant: "secondary" },
  live: { label: "live", variant: "default" },
  fixed: { label: "fixed", variant: "outline" },
};

export default async function BillingPage() {
  const b = await getBillingSummary();
  const maxRow = Math.max(0.01, ...b.rows.map((r) => r.monthUsd ?? 0));
  const pctMonth = Math.round(b.elapsedFraction * 100);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
          <p className="text-sm text-muted-foreground">
            What it costs to run this tool — {b.monthLabel} (day {b.dayOfMonth} of {b.daysInMonth}).
          </p>
        </div>
        <RefreshButton />
      </div>

      {/* Headline numbers */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">This month so far</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">{usd(b.totalMonthUsd)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {usd(b.fixedMonthlyUsd)} fixed · {usd(b.meteredMonthUsd + b.liveMonthUsd)} usage
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Projected month-end</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">{usd(b.projectedMonthUsd)}</div>
            <p className="text-xs text-muted-foreground mt-1">at current pace · {pctMonth}% of month elapsed</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">All-time usage spend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">{usd(b.allTimeUsd)}</div>
            <p className="text-xs text-muted-foreground mt-1">metered API calls, all time</p>
          </CardContent>
        </Card>
      </section>

      {/* Breakdown */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cost breakdown — this month</CardTitle>
            <CardDescription>Per provider. Fixed subscriptions count their full monthly amount.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {b.rows.length === 0 && <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>}
            {b.rows.map((r) => {
              const badge = KIND_BADGE[r.kind];
              const pct = r.monthUsd != null ? Math.round((r.monthUsd / maxRow) * 100) : 0;
              return (
                <div key={r.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate font-medium">{r.label}</span>
                      <Badge variant={badge.variant} className="shrink-0">{badge.label}</Badge>
                      {r.estimated && <span className="text-xs text-muted-foreground shrink-0">est.</span>}
                    </div>
                    <span className="tabular-nums font-medium shrink-0">
                      {r.monthUsd != null ? usd(r.monthUsd) : "—"}
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary/70" style={{ width: `${pct}%` }} />
                  </div>
                  {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daily usage spend</CardTitle>
            <CardDescription>Metered API calls (LLM tokens + AirScale lookups) per day.</CardDescription>
          </CardHeader>
          <CardContent>
            <SpendChart daily={b.daily} />
          </CardContent>
        </Card>
      </section>

      {/* Fixed subscriptions */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fixed monthly subscriptions</CardTitle>
            <CardDescription>
              Recurring costs with no per-call signal (Supabase, hosting, …). Edit amounts as your plans change.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FixedCostsEditor costs={b.fixedCosts} />
          </CardContent>
        </Card>
      </section>

      {/* Recent activity */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent metered calls</CardTitle>
            <CardDescription>Most recent paid API calls this month.</CardDescription>
          </CardHeader>
          <CardContent>
            {b.recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No metered calls yet this month.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Operation</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {b.recent.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(e.createdAt), { addSuffix: true })}
                      </TableCell>
                      <TableCell>{e.provider}</TableCell>
                      <TableCell className="text-muted-foreground">{e.operation}</TableCell>
                      <TableCell className="text-muted-foreground">{e.model ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {usd(e.costUsd)}{e.estimated && <span className="text-muted-foreground"> *</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </section>

      <p className="text-xs text-muted-foreground">
        * Usage figures marked &ldquo;est.&rdquo; are computed from published list pricing (LLM token rates,
        AirScale per-lookup rate) and may differ slightly from your invoice. Apify is read live from its
        billing API. Verify exact charges on each provider&rsquo;s dashboard.
      </p>
    </div>
  );
}
