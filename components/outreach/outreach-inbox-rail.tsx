"use client";
import { Mail, MailOpen, RefreshCw, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { InboxTrackTabs, ViewTabs, type OutreachView, type InboxTab } from "./outreach-tabs";
import { inboxCampaignTag, type InboxRow } from "./outreach-ready-client";

export function OutreachInboxRail({
  rows,
  selectedId,
  onSelect,
  activeTab,
  onTabChange,
  tabCounts,
  view,
  onViewChange,
  unreadCount,
  onRefresh,
  refreshing,
  refreshStatus,
}: {
  /** Already filtered to activeTab by the parent. */
  rows: InboxRow[];
  selectedId: string;
  onSelect: (id: string) => void;
  activeTab: InboxTab;
  onTabChange: (tab: InboxTab) => void;
  tabCounts: Record<InboxTab, number>;
  view: OutreachView;
  onViewChange: (view: OutreachView) => void;
  unreadCount: number;
  onRefresh: () => void;
  refreshing: boolean;
  refreshStatus: { ok: boolean; msg: string } | null;
}) {
  return (
    <aside className="border-r bg-muted/20 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b space-y-2">
        <h1 className="font-semibold tracking-tight">Outreach Ready</h1>
        <InboxTrackTabs activeTab={activeTab} onTabChange={onTabChange} tabCounts={tabCounts} />
        <ViewTabs view={view} onViewChange={onViewChange} unreadCount={unreadCount} />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="text-xs px-2 py-1 rounded-md border transition-colors hover:bg-accent disabled:opacity-50 flex items-center gap-1.5"
          >
            <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
            {refreshing ? "Checking…" : "Refresh"}
          </button>
          {rows.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {rows.length} repl{rows.length === 1 ? "y" : "ies"} · {unreadCount} unread
            </span>
          )}
        </div>
        {refreshStatus && (
          <p className={cn("text-xs flex items-center gap-1", refreshStatus.ok ? "text-green-700" : "text-red-700")}>
            {!refreshStatus.ok && <AlertCircle className="h-3 w-3 shrink-0" />}
            {refreshStatus.msg}
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => onSelect(row.id)}
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
        {rows.length === 0 && (
          <p className="text-xs text-muted-foreground px-4 py-6 text-center">
            No replies here yet. Hit Refresh to check your mailbox.
          </p>
        )}
      </div>
    </aside>
  );
}
