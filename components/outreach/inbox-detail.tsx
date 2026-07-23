"use client";
import Link from "next/link";
import { Mail, ExternalLink } from "lucide-react";
import type { InboxRow } from "./outreach-ready-client";

export function InboxDetail({ row }: { row: InboxRow }) {
  return (
    <div className="overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-5">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {row.from_name || row.from_email || "Unknown sender"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {row.from_email}
            {row.lead_username && ` · from @${row.lead_username}`}
            {` · ${new Date(row.received_at).toLocaleString()}`}
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
