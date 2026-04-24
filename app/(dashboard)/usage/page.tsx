import { fetchAllUsage } from "@/lib/usage/aggregate";
import { PROVIDERS, getProviderMeta } from "@/lib/usage/pricing";
import { UsageCard } from "@/components/usage/usage-card";
import { PricingTable } from "@/components/usage/pricing-table";
import { RefreshButton } from "@/components/usage/refresh-button";
import { formatDistanceToNow } from "date-fns";

export const dynamic = "force-dynamic";

export default async function UsagePage() {
  const statuses = await fetchAllUsage();
  const newest = statuses.reduce<string | null>(
    (acc, s) => (acc && acc > s.fetchedAt ? acc : s.fetchedAt),
    null,
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
          <p className="text-sm text-muted-foreground">
            Live credit status for connected tools.{" "}
            {newest && <>Last fetched {formatDistanceToNow(new Date(newest), { addSuffix: true })}.</>}
          </p>
        </div>
        <RefreshButton />
      </div>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {statuses.map((s) => (
          <UsageCard key={s.id} status={s} meta={getProviderMeta(s.id)} />
        ))}
      </section>

      <section>
        <h2 className="text-lg font-semibold tracking-tight mb-3">Pricing reference</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {PROVIDERS.map((p) => (
            <PricingTable key={p.id} meta={p} />
          ))}
        </div>
      </section>
    </div>
  );
}
