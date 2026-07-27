"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, MailOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { markReplyRead } from "@/app/actions/inbox";
import { inboxCampaignTag, type InboxRow } from "@/components/outreach/outreach-ready-client";
import { InboxDetail } from "@/components/outreach/inbox-detail";

// The Campaigns section's inbox — used both for the master inbox
// (app/(dashboard)/campaigns/page.tsx, every reply) and each campaign's own
// "Inbox" tab (app/(dashboard)/campaigns/[id]/page.tsx, that campaign's
// replies only). Deliberately not a reuse of OutreachInboxRail — that
// component is built around Outreach Ready's specific "ready vs inbox" view
// toggle and info/partnership track tabs, neither of which applies here;
// this is a plain two-pane list + detail, mirroring how CampaignSendPanel
// already manages its own selection state from server-fetched rows.
export function CampaignInboxPanel({ rows, senderName }: { rows: InboxRow[]; senderName: string | null }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string>(rows[0]?.id ?? "");
  const selected = rows.find((r) => r.id === selectedId) ?? rows[0];

  const handleSelect = (id: string) => {
    setSelectedId(id);
    const row = rows.find((r) => r.id === id);
    if (row && !row.is_read) {
      void markReplyRead(id, true).then(() => router.refresh());
    }
  };

  if (rows.length === 0) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        <Mail className="h-8 w-8 mx-auto mb-3 opacity-40" />
        <p className="text-sm">No replies here yet.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[300px_1fr] gap-4 min-h-[500px]">
      <div className="border-r overflow-y-auto">
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => handleSelect(row.id)}
            className={cn(
              "w-full text-left px-4 py-2.5 border-b hover:bg-accent transition-colors",
              row.id === selectedId && "bg-accent",
              !row.is_read && "bg-accent/30",
            )}
          >
            <div className="flex items-center gap-2">
              {row.is_read ? (
                <MailOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <Mail className="h-3.5 w-3.5 shrink-0 text-primary" />
              )}
              <span className={cn("text-sm truncate", !row.is_read && "font-semibold")}>
                {row.from_name || row.from_email || "Unknown sender"}
              </span>
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                {new Date(row.received_at).toLocaleDateString()}
              </span>
            </div>
            <div className="text-xs text-muted-foreground truncate mt-0.5 flex items-center gap-1.5">
              <span className="truncate">
                {row.lead_username ? `@${row.lead_username} — ` : ""}
                {row.subject || "(no subject)"}
              </span>
              <Badge variant="outline" className="text-[10px] shrink-0">{inboxCampaignTag(row)}</Badge>
            </div>
          </button>
        ))}
      </div>

      {selected ? (
        <InboxDetail key={selected.id} row={selected} senderName={senderName} />
      ) : (
        <div className="flex items-center justify-center text-sm text-muted-foreground">Select a reply</div>
      )}
    </div>
  );
}
