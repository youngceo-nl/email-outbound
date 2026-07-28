"use client";
import { renderTemplate, buildSampleContext, hasUnbalancedBrackets } from "@/lib/outreach/template";

// Shown under a subject/body field as the user types — resolves both
// {{placeholder}} tokens and [spintax|options] against a fixed sample lead,
// so authors can see one rendered example before saving.
export function TemplatePreview({ subject, body }: { subject?: string; body?: string }) {
  const ctx = buildSampleContext();
  const unbalanced = (subject != null && hasUnbalancedBrackets(subject)) || (body != null && hasUnbalancedBrackets(body));
  return (
    <div className="rounded-md border bg-muted/30 p-2.5 text-xs space-y-1">
      <p className="font-medium text-muted-foreground">Preview (sample lead)</p>
      {subject != null && (
        <p>
          <span className="text-muted-foreground">Subject: </span>
          {renderTemplate(subject, ctx)}
        </p>
      )}
      {body != null && <p className="whitespace-pre-wrap">{renderTemplate(body, ctx)}</p>}
      {unbalanced && (
        <p className="text-amber-600">Unmatched [ or ] — check your spintax brackets before saving.</p>
      )}
    </div>
  );
}
