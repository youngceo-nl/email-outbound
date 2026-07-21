"use client";
import { cn } from "@/lib/utils";
import { LEAD_CATEGORIES, CATEGORY_LABELS, type LeadCategory } from "@/lib/leads/category";

// Shared by the ready-to-send rail and the inbox rail so the two headers
// (category tabs + ready/inbox toggle) stay visually and behaviorally
// identical without either rail owning the other's markup.

export function CategoryTabs({
  activeCategory,
  onCategoryChange,
  categoryCounts,
}: {
  activeCategory: LeadCategory;
  onCategoryChange: (category: LeadCategory) => void;
  categoryCounts: Record<LeadCategory, number>;
}) {
  return (
    <div className="flex gap-1">
      {LEAD_CATEGORIES.map((category) => (
        <button
          key={category}
          type="button"
          onClick={() => onCategoryChange(category)}
          className={cn(
            "flex-1 text-xs px-2 py-1.5 rounded-md border transition-colors tabular-nums",
            category === activeCategory
              ? "bg-primary text-primary-foreground border-primary"
              : "hover:bg-accent",
          )}
        >
          {CATEGORY_LABELS[category]} {categoryCounts[category]}
        </button>
      ))}
    </div>
  );
}

export type OutreachView = "ready" | "inbox";

export function ViewTabs({
  view,
  onViewChange,
  unreadCount,
}: {
  view: OutreachView;
  onViewChange: (view: OutreachView) => void;
  /** Unread replies in the active category — shown as a badge on the Inbox pill. */
  unreadCount: number;
}) {
  return (
    <div className="flex gap-1">
      <button
        type="button"
        onClick={() => onViewChange("ready")}
        className={cn(
          "flex-1 text-xs px-2 py-1 rounded-md border transition-colors",
          view === "ready" ? "bg-accent border-accent-foreground/20 font-medium" : "hover:bg-accent",
        )}
      >
        Ready to send
      </button>
      <button
        type="button"
        onClick={() => onViewChange("inbox")}
        className={cn(
          "flex-1 text-xs px-2 py-1 rounded-md border transition-colors flex items-center justify-center gap-1.5",
          view === "inbox" ? "bg-accent border-accent-foreground/20 font-medium" : "hover:bg-accent",
        )}
      >
        Inbox
        {unreadCount > 0 && (
          <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] tabular-nums">
            {unreadCount}
          </span>
        )}
      </button>
    </div>
  );
}
