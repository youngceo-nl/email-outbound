import Link from "next/link";
import { ExternalLink, Youtube, Linkedin, Mail } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChurnActions } from "@/components/leads/churn-actions";
import { RetryChurnButton } from "@/components/leads/retry-churn-button";
import { formatNumber } from "@/lib/utils";
import { scoreColor } from "@/lib/utils";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ChurnPage() {
  const sb = createAdminClient();

  const { data: leads, count } = await sb
    .from("leads")
    .select("*", { count: "exact" })
    .eq("status", "qualified")
    .is("email", null)
    .not("enriched_at", "is", null)
    .eq("outreach_count", 0)
    .order("overall_score", { ascending: false })
    .limit(100);

  const rows = (leads ?? []) as Lead[];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Churn Bucket</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Qualified leads where automated email enrichment ran but found nothing. Look them up manually —
          check their website, YouTube about page, or other sources. If you find the email, add it on
          their profile page and they'll leave this list automatically. If you've tried and can't find
          anything, hit <strong>Dismiss</strong> to clear them out.
        </p>
      </div>
      <RetryChurnButton total={rows.length} />
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Mail className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">Churn bucket is empty</p>
            <p className="text-sm text-muted-foreground mt-1">
              Leads only land here when they're qualified, enriched, and still have no email.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{formatNumber(count ?? rows.length)} leads need manual email lookup</CardTitle>
            <CardDescription>
              Sorted by score. Hit <strong>Retry email</strong> first — sometimes a second pass finds something.
              Otherwise look them up manually, add the email on their profile page, and they'll disappear from here automatically.
              Can't find anything? Hit <strong>Dismiss</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {rows.map((lead) => (
                <div key={lead.id} className="flex items-start gap-4 px-6 py-4 hover:bg-muted/30 transition-colors">
                  {/* Score */}
                  <div className="shrink-0 mt-0.5">
                    <span className={`inline-block px-2 py-0.5 rounded text-sm font-semibold tabular-nums ${scoreColor(lead.overall_score)}`}>
                      {lead.overall_score != null ? Number(lead.overall_score).toFixed(1) : "—"}
                    </span>
                  </div>

                  {/* Identity */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href={lead.profile_url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium hover:underline flex items-center gap-1"
                      >
                        @{lead.username}
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </a>
                      {lead.full_name && (
                        <span className="text-sm text-muted-foreground">{lead.full_name}</span>
                      )}
                      {lead.niche && (
                        <span className="text-xs bg-muted rounded-full px-2 py-0.5 text-muted-foreground">
                          {lead.niche}
                        </span>
                      )}
                      {lead.followers != null && (
                        <span className="text-xs text-muted-foreground">
                          {formatNumber(lead.followers)} followers
                        </span>
                      )}
                    </div>

                    {lead.bio && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{lead.bio}</p>
                    )}

                    {/* External links */}
                    <div className="flex items-center gap-3 mt-1.5">
                      {lead.youtube_url && (
                        <a href={lead.youtube_url} target="_blank" rel="noreferrer"
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                          <Youtube className="h-3.5 w-3.5 text-red-500" /> YouTube
                        </a>
                      )}
                      {lead.linkedin_url && (
                        <a href={lead.linkedin_url} target="_blank" rel="noreferrer"
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                          <Linkedin className="h-3.5 w-3.5 text-blue-600" /> LinkedIn
                        </a>
                      )}
                      <Link href={`/leads/${lead.username}`}
                        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
                        View full profile →
                      </Link>
                    </div>
                  </div>

                  {/* Actions */}
                  <ChurnActions lead={lead} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
