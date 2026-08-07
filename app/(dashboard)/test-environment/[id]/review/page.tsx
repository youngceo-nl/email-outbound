import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getQualificationRun } from "@/app/actions/test-environment";
import { getRunReviewQueue } from "@/app/actions/review";
import { EvidenceReviewClient } from "@/components/review/evidence-review-client";

export const dynamic = "force-dynamic";

export default async function RunReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const run = await getQualificationRun(id);
  if (!run) notFound();

  const queue = await getRunReviewQueue(id);

  return (
    <div className="p-6 space-y-4">
      <Link
        href={`/test-environment/${id}`}
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center"
      >
        <ChevronLeft className="h-4 w-4 mr-1" />
        Back to run
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Reviewing {run.label ?? `Run ${run.id.slice(0, 8)}`}
        </h1>
        <p className="text-sm text-muted-foreground">
          Every lead this batch scored ({queue.length}), regardless of decision — approving or
          rejecting here overrides any older review verdict the lead already had.
        </p>
      </div>

      {queue.length === 0 ? (
        <Card className="max-w-2xl mx-auto">
          <CardContent className="py-16 text-center text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No scored leads in this run.</p>
          </CardContent>
        </Card>
      ) : (
        <EvidenceReviewClient queue={queue} totalPending={queue.length} runId={id} />
      )}
    </div>
  );
}
