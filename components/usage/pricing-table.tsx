import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink } from "lucide-react";
import type { ProviderMeta } from "@/lib/usage/pricing";

export function PricingTable({ meta }: { meta: ProviderMeta }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{meta.name} plans</CardTitle>
        <a
          href={meta.pricingUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          full pricing <ExternalLink className="h-3 w-3" />
        </a>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {meta.tiers.map((t) => (
            <li key={t.name} className="flex items-baseline justify-between py-2 text-sm">
              <span className="font-medium">{t.name}</span>
              <span className="text-right">
                <span className="font-semibold tabular-nums">{t.price}</span>
                <span className="text-xs text-muted-foreground"> {t.unit}</span>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
