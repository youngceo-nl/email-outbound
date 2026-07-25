"use client";
import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { BatchDestination, BatchRecord } from "@/lib/handover/batches";
import { Badge } from "@/components/ui/badge";

const DEST_LABEL: Record<BatchDestination, string> = {
  outreach_ready: "Outreach Ready",
  contacted: "Contacted",
  no_email: "No email",
  pending: "Out with Clay",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DestBadge({ dest }: { dest: BatchDestination }) {
  if (dest === "outreach_ready") {
    return (
      <Link href="/outreach-ready" className="text-emerald-600 dark:text-emerald-400 hover:underline">
        {DEST_LABEL[dest]}
      </Link>
    );
  }
  const cls =
    dest === "no_email" ? "text-muted-foreground" : dest === "pending" ? "text-blue-600 dark:text-blue-400" : "text-foreground";
  return <span className={cls}>{DEST_LABEL[dest]}</span>;
}

// One batch within an account group. The account name lives on the group header,
// so the batch leads with its claim date instead.
function BatchCard({ batch }: { batch: BatchRecord }) {
  const [open, setOpen] = useState(false);
  const isOpen = batch.status === "open";

  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-accent transition-colors"
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm">{isOpen ? "Open batch" : `Batch · ${fmtDate(batch.createdAt)}`}</span>
            {isOpen && <Badge variant="secondary" className="text-[10px]">open</Badge>}
            <span className="text-xs text-muted-foreground">{batch.total} lead{batch.total === 1 ? "" : "s"}</span>
          </div>
          <div className="mt-1 flex items-center gap-x-3 gap-y-0.5 flex-wrap text-xs text-muted-foreground tabular-nums">
            <span>
              <span className="font-medium text-emerald-600 dark:text-emerald-400">{batch.emailFound}</span> email
            </span>
            <span>
              <span className="font-medium text-foreground/80">{batch.noEmail}</span> no email
            </span>
            {batch.pending > 0 && (
              <span>
                <span className="font-medium text-blue-600 dark:text-blue-400">{batch.pending}</span> out with Clay
              </span>
            )}
          </div>
        </div>
        <div className="text-right text-[11px] text-muted-foreground shrink-0">
          {!isOpen && <div>closed {fmtDate(batch.closedAt)}</div>}
        </div>
      </button>

      {open && (
        <div className="border-t">
          {batch.leads.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No leads still linked to this batch (any results were marked bad or returned to the pool).
            </p>
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {batch.leads.map((lead) => (
                  <tr key={lead.username} className="border-b last:border-0">
                    <td className="px-3 py-1.5 font-medium">
                      <Link href={`/leads/${lead.username}`} className="hover:underline">
                        {lead.username}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[12rem]">{lead.fullName ?? "—"}</td>
                    <td className="px-3 py-1.5">
                      {lead.email ? (
                        <span className="text-emerald-600 dark:text-emerald-400">{lead.email}</span>
                      ) : (
                        <span className="text-muted-foreground">no email found</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <DestBadge dest={lead.destination} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// All of one source account's batches, with the account's aggregate outcome on
// the header — so a lead always shows up under the account it came from.
function AccountGroup({ parentUsername, batches }: { parentUsername: string; batches: BatchRecord[] }) {
  const totalLeads = batches.reduce((s, b) => s + b.total, 0);
  const emailSum = batches.reduce((s, b) => s + b.emailFound, 0);
  const noEmailSum = batches.reduce((s, b) => s + b.noEmail, 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap px-1">
        <span className="font-medium text-sm">@{parentUsername}</span>
        <span className="text-xs text-muted-foreground">
          {batches.length} batch{batches.length === 1 ? "" : "es"} · {totalLeads} lead{totalLeads === 1 ? "" : "s"}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          <span className="font-medium text-emerald-600 dark:text-emerald-400">{emailSum}</span> email ·{" "}
          <span className="font-medium text-foreground/80">{noEmailSum}</span> no email
        </span>
      </div>
      <div className="space-y-2 border-l pl-3 ml-1">
        {batches.map((batch) => (
          <BatchCard key={batch.id} batch={batch} />
        ))}
      </div>
    </div>
  );
}

export function BatchHistory({ batches }: { batches: BatchRecord[] }) {
  if (batches.length === 0) {
    return <p className="text-sm text-muted-foreground">No batches yet.</p>;
  }

  // Group by source account, preserving order — batches arrive newest-first, so
  // accounts end up ordered by their most recent batch.
  const groups: { parentUsername: string; batches: BatchRecord[] }[] = [];
  const index = new Map<string, BatchRecord[]>();
  for (const batch of batches) {
    let list = index.get(batch.parentUsername);
    if (!list) {
      list = [];
      index.set(batch.parentUsername, list);
      groups.push({ parentUsername: batch.parentUsername, batches: list });
    }
    list.push(batch);
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <AccountGroup key={g.parentUsername} parentUsername={g.parentUsername} batches={g.batches} />
      ))}
    </div>
  );
}
