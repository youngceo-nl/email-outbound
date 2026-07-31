"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buildLeadContext, renderTemplate } from "@/lib/outreach/template";
import { LEAD_CATEGORIES, leadCategory, leadTrackFor, type CategoryTemplates, type LeadCategory } from "@/lib/leads/category";
import { syncInbox, markReplyRead } from "@/app/actions/inbox";
import type { LeadStatus } from "@/lib/types";
import type { HandoverOutcome } from "@/lib/handover/outcomes";
import type { OutreachView, InboxTab } from "./outreach-tabs";
import { OutreachLeadRail } from "./outreach-lead-rail";
import { OutreachInboxRail } from "./outreach-inbox-rail";
import { OutreachComposer } from "./outreach-composer";
import { InboxDetail } from "./inbox-detail";

export type OutreachCampaignInfo = {
  id: string;
  name: string;
  stepNumber: number;
  totalSteps: number;
  isDue: boolean;
  dueAt: string | null;
  subjectTemplate: string;
  bodyTemplate: string;
};

export type OutreachRow = {
  id: string;
  username: string;
  full_name: string | null;
  niche: string | null;
  business_model: string | null;
  funnel_program_name: string | null;
  funnel_offer_summary: string | null;
  external_link: string | null;
  email: string;
  email_provider: string | null;
  overall_score: number | null;
  status: LeadStatus;
  firstName: string | null;
  needsFix: boolean;
  // Only populated for cold/warm follow-up chains (never primary campaigns):
  // template placeholders this row's due step uses that don't resolve to a
  // real value for this lead — see lib/outreach/needs-input.ts. A non-empty
  // array is why auto-send-followups skipped this row rather than sending it.
  autoSendBlockedKeys?: string[];
  parent_username: string | null;
  sourceOutcome: HandoverOutcome | null;
  campaign: OutreachCampaignInfo | null;
};

export type InboxRow = {
  id: string;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  received_at: string;
  // The original outreach's send timestamp (outreach_messages.sent_at via
  // inbox_messages.outreach_message_id) — null for a legacy/orphaned reply
  // whose originating send row didn't resolve.
  sent_at: string | null;
  is_read: boolean;
  // AI sentiment classification (lib/openai/classify-reply.ts) — drives
  // whether the positive-reply template shows up in InboxDetail.
  sentiment: "positive" | "neutral" | "negative" | null;
  // The inbound message's own RFC Message-Id and its thread's Gmail thread
  // id — needed to send a reply that actually lands in the same thread.
  gmail_message_id: string | null;
  gmail_thread_id: string | null;
  // Set once a reply has actually been sent in-app (app/actions/inbox.ts's
  // sendInboxReply) — powers the "you replied on ..." annotation.
  replied_at: string | null;
  lead_id: string;
  lead_username: string | null;
  lead_full_name: string | null;
  business_model: string | null;
  // Fields needed to render the positive-reply template via
  // buildLeadContext/renderTemplate, same as outreach templates.
  niche: string | null;
  funnel_program_name: string | null;
  funnel_offer_summary: string | null;
  external_link: string | null;
  campaign_name: string | null;
  campaign_variant_label: string | null;
  // The lead's campaign's canned positive-reply template, unrendered.
  positive_reply_template: string | null;
};

export type Draft = { full_name: string; funnel_program_name: string };

// Shared by inbox-detail.tsx, outreach-inbox-rail.tsx, and
// campaigns/campaign-inbox-panel.tsx so every inbox row always shows a
// clear tag — "{campaign} · {variant}" when campaign-assigned, or an
// explicit "Not in a campaign" badge rather than no badge at all.
export function inboxCampaignTag(row: Pick<InboxRow, "campaign_name" | "campaign_variant_label">): string {
  return row.campaign_name ? `${row.campaign_name} · ${row.campaign_variant_label ?? "—"}` : "Not in a campaign";
}

// e.g. "Jan 10, 2026, 12:51 PM GMT+5:30" — used by inbox-detail.tsx to show
// both when an outreach was sent and when its reply came in, explicit
// timezone included so it's unambiguous across senders/recipients.
export function formatWithTz(iso: string): string {
  // Some Intl/ICU builds throw "Invalid option : option" when timeZoneName is
  // combined with dateStyle/timeStyle, so spell out the fields explicitly.
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function OutreachReadyClient({
  rows,
  inboxRows,
  templates,
  senderName,
  sentToday,
  dryRun,
}: {
  rows: OutreachRow[];
  inboxRows: InboxRow[];
  templates: CategoryTemplates;
  senderName: string | null;
  sentToday: number;
  dryRun: boolean;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  // A sent lead drops out of the server query on refresh; keep it visible for
  // the session so the rail doesn't silently reshuffle under the user.
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [needsFixOnly, setNeedsFixOnly] = useState(false);
  const [view, setView] = useState<OutreachView>("ready");
  const [selectedInboxId, setSelectedInboxId] = useState<string>(inboxRows[0]?.id ?? "");
  const [activeInboxTab, setActiveInboxTab] = useState<InboxTab>("all");
  const [syncing, startSync] = useTransition();
  const [syncStatus, setSyncStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // Per-category counts, excluding already-sent-this-session rows so the tab
  // bar matches the "ready" semantics shown elsewhere. Also decides the
  // default tab on first render: whichever category has the most ready
  // leads, Info as the tie-break since that's the more common target.
  const categoryCounts = useMemo(() => {
    const counts: Record<LeadCategory, number> = { partnerships: 0, info: 0, other: 0 };
    for (const row of rows) if (!sentIds.has(row.id)) counts[leadCategory(row.business_model)]++;
    return counts;
  }, [rows, sentIds]);
  const defaultCategory = useMemo<LeadCategory>(() => {
    const [top] = [...LEAD_CATEGORIES].sort((a, b) => categoryCounts[b] - categoryCounts[a]);
    return categoryCounts[top] > 0 ? top : "info";
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the initial mount's counts should pick the default tab
  }, []);

  const [activeCategory, setActiveCategory] = useState<LeadCategory>(defaultCategory);

  const rowsInCategory = (category: LeadCategory) =>
    rows.filter((r) => leadCategory(r.business_model) === category);

  const [selectedId, setSelectedId] = useState<string>(
    () => rowsInCategory(defaultCategory)[0]?.id ?? rows[0]?.id ?? "",
  );

  const rowsInInboxTab = (tab: InboxTab) =>
    tab === "all" ? inboxRows : inboxRows.filter((r) => leadTrackFor(r.business_model) === tab);

  const handleCategoryChange = (category: LeadCategory) => {
    setActiveCategory(category);
    const inCategory = rowsInCategory(category);
    const stillVisible = inCategory.some((r) => r.id === selectedId && !sentIds.has(r.id));
    if (!stillVisible) {
      const next = inCategory.find((r) => !sentIds.has(r.id)) ?? inCategory[0];
      setSelectedId(next?.id ?? "");
    }
  };

  const handleInboxTabChange = (tab: InboxTab) => {
    setActiveInboxTab(tab);
    const inTab = rowsInInboxTab(tab);
    if (!inTab.some((r) => r.id === selectedInboxId)) {
      setSelectedInboxId(inTab[0]?.id ?? "");
    }
  };

  const handleViewChange = (next: OutreachView) => {
    setView(next);
    if (next === "inbox") {
      const inTab = rowsInInboxTab(activeInboxTab);
      if (!inTab.some((r) => r.id === selectedInboxId)) {
        setSelectedInboxId(inTab[0]?.id ?? "");
      }
    }
  };

  const handleSelectInbox = (id: string) => {
    setSelectedInboxId(id);
    const row = inboxRows.find((r) => r.id === id);
    if (row && !row.is_read) {
      void markReplyRead(id, true).then(() => router.refresh());
    }
  };

  const handleRefreshInbox = () => {
    setSyncStatus(null);
    startSync(async () => {
      const r = await syncInbox();
      if (r.ok) {
        setSyncStatus({ ok: true, msg: `Checked — ${r.new_replies ?? 0} new repl${r.new_replies === 1 ? "y" : "ies"} found.` });
        router.refresh();
      } else {
        setSyncStatus({ ok: false, msg: r.error ?? "Check failed." });
      }
    });
  };

  const selected = rows.find((r) => r.id === selectedId) ?? rowsInCategory(activeCategory)[0];

  const draftFor = (row: OutreachRow): Draft =>
    drafts[row.id] ?? {
      full_name: row.full_name ?? "",
      funnel_program_name: row.funnel_program_name ?? "",
    };

  const setDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((d) => {
      const row = rows.find((r) => r.id === id);
      const base = d[id] ?? {
        full_name: row?.full_name ?? "",
        funnel_program_name: row?.funnel_program_name ?? "",
      };
      return { ...d, [id]: { ...base, ...patch } };
    });

  // The whole point of the screen: rendering is pure and synchronous, so the
  // subject and greeting update as the user types with no network round-trip.
  // Template pair is chosen by the SELECTED lead's own category, which is
  // always the active tab's category — but reading it off the lead rather
  // than the tab keeps this correct even if selection and tab ever drift.
  const rendered = useMemo(() => {
    if (!selected) return { subject: "", body: "" };
    const draft = drafts[selected.id] ?? {
      full_name: selected.full_name ?? "",
      funnel_program_name: selected.funnel_program_name ?? "",
    };
    const ctx = buildLeadContext({
      lead: {
        username: selected.username,
        full_name: draft.full_name || null,
        niche: selected.niche,
        business_model: selected.business_model,
        funnel_program_name: draft.funnel_program_name || null,
        funnel_offer_summary: selected.funnel_offer_summary,
        external_link: selected.external_link,
      },
      senderName,
    });
    const template = selected.campaign
      ? { subject: selected.campaign.subjectTemplate, body: selected.campaign.bodyTemplate }
      : templates[leadCategory(selected.business_model)];
    return {
      subject: renderTemplate(template.subject, ctx),
      body: renderTemplate(template.body, ctx),
      firstName: String(ctx.first_name ?? ""),
      programName: String(ctx.program_name ?? ""),
    };
  }, [selected, drafts, templates, senderName]);

  const visibleInCategory = rowsInCategory(activeCategory);

  const onSent = (id: string) => {
    setSentIds((s) => new Set(s).add(id));
    const remaining = visibleInCategory.filter((r) => r.id !== id && !sentIds.has(r.id));
    if (remaining.length) setSelectedId(remaining[0].id);
    router.refresh();
  };

  const needsFixCount = visibleInCategory.filter((r) => r.needsFix && !sentIds.has(r.id)).length;

  // Total unread across the whole inbox — shown on the ready side's Inbox
  // pill, which has no matching dimension to split by (ready tabs are
  // category-based, inbox tabs are track-based).
  const totalUnread = useMemo(() => inboxRows.filter((r) => !r.is_read).length, [inboxRows]);

  // Inbox tab counts (All/Info/Partnerships) — total rows per tab, used for
  // the tab bar itself.
  const inboxTabCounts = useMemo(() => {
    const counts: Record<InboxTab, number> = { all: inboxRows.length, infopreneur: 0, partnership: 0 };
    for (const row of inboxRows) counts[leadTrackFor(row.business_model)]++;
    return counts;
  }, [inboxRows]);

  const visibleInboxRows = rowsInInboxTab(activeInboxTab);
  const selectedInboxRow = inboxRows.find((r) => r.id === selectedInboxId) ?? visibleInboxRows[0];

  return (
    <div className="grid grid-cols-[300px_1fr] h-[calc(100vh-11rem)] overflow-hidden rounded-lg border">
      {view === "ready" ? (
        <OutreachLeadRail
          rows={visibleInCategory}
          selectedId={selected?.id ?? ""}
          onSelect={setSelectedId}
          sentIds={sentIds}
          drafts={drafts}
          readyCount={visibleInCategory.length - visibleInCategory.filter((r) => sentIds.has(r.id)).length}
          needsFixCount={needsFixCount}
          sentToday={sentToday}
          needsFixOnly={needsFixOnly}
          onToggleNeedsFix={() => setNeedsFixOnly((v) => !v)}
          activeCategory={activeCategory}
          onCategoryChange={handleCategoryChange}
          categoryCounts={categoryCounts}
          view={view}
          onViewChange={handleViewChange}
          unreadCount={totalUnread}
          showInboxToggle={false}
        />
      ) : (
        <OutreachInboxRail
          rows={visibleInboxRows}
          selectedId={selectedInboxRow?.id ?? ""}
          onSelect={handleSelectInbox}
          activeTab={activeInboxTab}
          onTabChange={handleInboxTabChange}
          tabCounts={inboxTabCounts}
          view={view}
          onViewChange={handleViewChange}
          unreadCount={visibleInboxRows.filter((r) => !r.is_read).length}
          onRefresh={handleRefreshInbox}
          refreshing={syncing}
          refreshStatus={syncStatus}
        />
      )}

      {view === "ready" ? (
        selected ? (
          <OutreachComposer
            key={selected.id}
            row={selected}
            draft={draftFor(selected)}
            onDraftChange={(patch) => setDraft(selected.id, patch)}
            subject={rendered.subject}
            body={rendered.body}
            firstName={rendered.firstName ?? ""}
            programName={rendered.programName ?? ""}
            senderName={senderName}
            alreadySent={sentIds.has(selected.id)}
            dryRun={dryRun}
            onSent={() => onSent(selected.id)}
          />
        ) : (
          <div className="flex items-center justify-center text-sm text-muted-foreground">
            Select a lead
          </div>
        )
      ) : selectedInboxRow ? (
        <InboxDetail key={selectedInboxRow.id} row={selectedInboxRow} senderName={senderName} />
      ) : (
        <div className="flex items-center justify-center text-sm text-muted-foreground">
          No replies in this tab yet
        </div>
      )}
    </div>
  );
}
