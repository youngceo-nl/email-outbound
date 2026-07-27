"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mail, ExternalLink, Send, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendInboxReply } from "@/app/actions/inbox";
import { buildLeadContext, renderTemplate } from "@/lib/outreach/template";
import { formatWithTz, inboxCampaignTag, type InboxRow } from "./outreach-ready-client";

export function InboxDetail({ row, senderName }: { row: InboxRow; senderName: string | null }) {
  const router = useRouter();
  const showTemplate = row.sentiment === "positive" && !!row.positive_reply_template && !row.replied_at;

  const [draft, setDraft] = useState<string>(() => {
    if (!showTemplate) return "";
    const ctx = buildLeadContext({
      lead: {
        username: row.lead_username ?? "",
        full_name: row.lead_full_name,
        niche: row.niche,
        business_model: row.business_model,
        funnel_program_name: row.funnel_program_name,
        funnel_offer_summary: row.funnel_offer_summary,
        external_link: row.external_link,
      },
      senderName,
    });
    return renderTemplate(row.positive_reply_template!, ctx);
  });
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  const send = async () => {
    setSending(true);
    setStatus(null);
    const r = await sendInboxReply(row.id, draft);
    setSending(false);
    if (r.ok) {
      setStatus({ ok: true, msg: r.dryRun ? "Sent (dry run — no real email went out)." : "Reply sent." });
      router.refresh();
    } else {
      setStatus({ ok: false, msg: r.error ?? "Send failed." });
    }
  };

  return (
    <div className="overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">
              {row.from_name || row.from_email || "Unknown sender"}
            </h2>
            <Badge variant="outline" className="text-xs">{inboxCampaignTag(row)}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {row.from_email}
            {row.lead_username && ` · from @${row.lead_username}`}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {row.sent_at
              ? `Sent ${formatWithTz(row.sent_at)} → Replied ${formatWithTz(row.received_at)}`
              : `Replied ${formatWithTz(row.received_at)}`}
          </p>
        </div>

        <div className="rounded-lg border overflow-hidden">
          <div className="bg-muted/40 px-4 py-3 border-b text-sm font-medium">
            {row.subject || "(no subject)"}
          </div>
          <div className="p-5 bg-white text-black text-sm whitespace-pre-wrap break-words">
            {row.body_text?.trim() || row.snippet || "(empty message)"}
          </div>
        </div>

        {row.replied_at && (
          <p className="text-xs text-green-700 flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" /> You replied on {formatWithTz(row.replied_at)}
          </p>
        )}

        {showTemplate && (
          <div className="rounded-lg border p-4 space-y-2 bg-muted/20">
            <p className="text-xs font-medium text-muted-foreground">
              Positive reply — template ready, edit before sending
            </p>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={8}
              className="text-sm bg-white text-black"
            />
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" onClick={send} disabled={sending || !draft.trim()}>
                {sending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                )}
                Send reply
              </Button>
              {status && (
                <span className={cn("inline-flex items-center gap-1 text-xs", status.ok ? "text-green-700" : "text-red-700")}>
                  {status.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                  {status.msg}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-4 text-sm">
          {row.from_email && (
            <a href={`mailto:${row.from_email}`} className="inline-flex items-center gap-1.5 hover:underline">
              <Mail className="h-3.5 w-3.5" /> Reply in email
            </a>
          )}
          {row.lead_username && (
            <Link href={`/leads/${row.lead_username}`} className="inline-flex items-center gap-1.5 hover:underline">
              <ExternalLink className="h-3.5 w-3.5" /> View lead
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
