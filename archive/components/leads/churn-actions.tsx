"use client";
import { useTransition } from "react";
import { UserX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EnrichButton } from "@/components/leads/enrich-button";
import { recordManualOutreach, rejectLead } from "@/app/actions/leads";
import type { Lead } from "@/lib/types";

export function ChurnActions({ lead }: { lead: Lead }) {
  const [pending, start] = useTransition();

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <EnrichButton
        leadId={lead.id}
        initialEmail={lead.email}
        initialStatus={lead.email_status}
        initialError={lead.enrichment_error}
        size="sm"
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        title="Looked it up manually, couldn't find anything — remove from list"
        onClick={() => start(async () => { await recordManualOutreach(lead.id); })}
      >
        <X className="h-3.5 w-3.5 mr-1" />
        Dismiss
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        title="Reject this lead"
        onClick={() => start(async () => { await rejectLead(lead.id); })}
        className="text-muted-foreground hover:text-destructive"
      >
        <UserX className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
