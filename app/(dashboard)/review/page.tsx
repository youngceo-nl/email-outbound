import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { getReviewQueue, getReviewStats, getReviewTrackCounts } from "@/app/actions/review";
import { Card, CardContent } from "@/components/ui/card";
import { ReviewClient } from "@/components/review/review-client";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  // Defense-in-depth on top of middleware.ts's redirect — VA accounts never
  // see the human-review queue (docs/va-access-restrictions.md).
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (user?.app_metadata?.role === "va") redirect("/");

  // Default to the infopreneur track; the client's tabs re-fetch on switch.
  const [queue, stats, trackCounts] = await Promise.all([
    getReviewQueue(100, "asc", "infopreneur"),
    getReviewStats(),
    getReviewTrackCounts(),
  ]);

  if (trackCounts.infopreneur === 0 && trackCounts.partnership === 0) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold tracking-tight mb-4">Review</h1>
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">Nothing left to review.</p>
            <p className="text-xs mt-1">
              Every AI-qualified lead has a human verdict. New ones show up here as they&apos;re scored.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <ReviewClient queue={queue} stats={stats} trackCounts={trackCounts} />;
}
