"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cn, scoreColor } from "@/lib/utils";
import { buildLeadContext, renderTemplate } from "@/lib/outreach/template";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Mail } from "lucide-react";
import { OutreachComposer } from "@/components/outreach/outreach-composer";
import type { Draft, OutreachRow } from "@/components/outreach/outreach-ready-client";

export function CampaignSendPanel({
  rows,
  senderName,
  dryRun,
}: {
  rows: OutreachRow[];
  senderName: string | null;
  dryRun: boolean;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string>(rows[0]?.id ?? "");

  const selected = rows.find((r) => r.id === selectedId) ?? rows[0];

  const draftFor = (row: OutreachRow): Draft =>
    drafts[row.id] ?? { full_name: row.full_name ?? "", funnel_program_name: row.funnel_program_name ?? "" };

  const setDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((d) => {
      const row = rows.find((r) => r.id === id);
      const base = d[id] ?? { full_name: row?.full_name ?? "", funnel_program_name: row?.funnel_program_name ?? "" };
      return { ...d, [id]: { ...base, ...patch } };
    });

  const rendered = useMemo(() => {
    if (!selected?.campaign) return { subject: "", body: "" };
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
    return {
      subject: renderTemplate(selected.campaign.subjectTemplate, ctx),
      body: renderTemplate(selected.campaign.bodyTemplate, ctx),
      firstName: String(ctx.first_name ?? ""),
      programName: String(ctx.program_name ?? ""),
    };
  }, [selected, drafts, senderName]);

  const onSent = (id: string) => {
    setSentIds((s) => new Set(s).add(id));
    const remaining = rows.filter((r) => r.id !== id && !sentIds.has(r.id));
    if (remaining.length) setSelectedId(remaining[0].id);
    router.refresh();
  };

  if (rows.length === 0) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        <Mail className="h-8 w-8 mx-auto mb-3 opacity-40" />
        <p className="text-sm">No leads due right now.</p>
        <p className="text-xs mt-1">
          A lead shows up here once it's assigned, has a valid email, and its next step is due.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[260px_1fr] gap-4 min-h-[500px]">
      <div className="border-r pr-3 space-y-1 overflow-y-auto">
        {rows.map((row) => {
          const sent = sentIds.has(row.id);
          return (
            <button
              key={row.id}
              type="button"
              onClick={() => setSelectedId(row.id)}
              className={cn(
                "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                row.id === selectedId ? "bg-accent" : "hover:bg-accent/50",
                sent && "opacity-50",
              )}
            >
              <div className="flex items-center gap-2">
                <span className={cn("text-xs font-semibold tabular-nums", scoreColor(row.overall_score))}>
                  {row.overall_score ?? "–"}
                </span>
                <span className={cn("truncate", sent && "line-through")}>@{row.username}</span>
                {sent && <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0 ml-auto" />}
              </div>
              {row.campaign && (
                <Badge variant="outline" className="text-[10px] mt-1">
                  step {row.campaign.stepNumber} of {row.campaign.totalSteps}
                  {!row.campaign.isDue ? " · not due yet" : ""}
                </Badge>
              )}
              {(row.autoSendBlockedKeys?.length ?? 0) > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] mt-1 ml-1 bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
                  title={`Auto-send skipped this row — missing: ${row.autoSendBlockedKeys!.join(", ")}`}
                >
                  needs input: {row.autoSendBlockedKeys!.join(", ")}
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      {selected ? (
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
        <div className="flex items-center justify-center text-sm text-muted-foreground">Select a lead</div>
      )}
    </div>
  );
}
