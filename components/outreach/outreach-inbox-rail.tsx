"use client";
import { Mail, MailOpen, RefreshCw, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LeadCategory } from "@/lib/leads/category";
import { CategoryTabs, ViewTabs, type OutreachView } from "./outreach-tabs";
import type { InboxRow } from "./outreach-ready-client";

export function OutreachInboxRail({
  rows,
  selectedId,
  onSelect,
  activeCategory,
  onCategoryChange,
  categoryCounts,
  view,
  onViewChange,
  unreadCount,
  onRefresh,
  refreshing,
  refreshStatus,
}: {
  /** Already filtered to activeCategory by the parent. */
  rows: InboxRow[];
  selectedId: string;
  onSelect: (id: string) => void;
  activeCategory: LeadCategory;
  onCategoryChange: (category: LeadCategory) => void;
  categoryCounts: Record<LeadCategory, number>;
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
        <CategoryTabs activeCategory={activeCategory} onCategoryChange={onCategoryChange} categoryCounts={categoryCounts} />
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
            <div className="text-xs text-muted-foreground truncate mt-0.5">
              {row.lead_username ? `@${row.lead_username} — ` : ""}
              {row.subject || "(no subject)"}
            </div>
          </button>
        ))}
        {rows.length === 0 && (
          <p className="text-xs text-muted-foreground px-4 py-6 text-center">
            No replies in this category yet. Hit Refresh to check your mailbox.
          </p>
        )}
      </div>
    </aside>
  );
}
