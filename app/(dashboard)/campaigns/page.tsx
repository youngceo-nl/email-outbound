import { listCampaigns, listDeletedCampaigns } from "@/app/actions/campaigns";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/config/settings";
import { getInboxRows } from "@/lib/inbox/rows";
import { cn, formatNumber } from "@/lib/utils";
import Link from "next/link";
import { Mail, MessageSquareHeart, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NewCampaignForm } from "@/components/campaigns/new-campaign-form";
import { CampaignRow } from "@/components/campaigns/campaign-row";
import { DeletedCampaignsSection } from "@/components/campaigns/deleted-campaigns-section";
import { CampaignInboxPanel } from "@/components/campaigns/campaign-inbox-panel";
import { OutreachReadyClient, type OutreachRow } from "@/components/outreach/outreach-ready-client";
import { resolveReadyEmail } from "@/lib/outreach/ready-filter";
import { extractFirstName, extractFirstNameFromUsername } from "@/lib/outreach/template";
import type { CategoryTemplates } from "@/lib/leads/category";
import { getHandoverOutcomesByParent } from "@/lib/handover/outcomes";
import { ReportsList, type ReportListItem } from "@/components/reports/reports-list";
import { GenerateButton } from "@/components/reports/generate-button";

export const dynamic = "force-dynamic";

const VIEWS = ["campaigns", "adhoc", "inbox", "reports"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABELS: Record<View, string> = {
  campaigns: "Campaigns",
  adhoc: "Ad-hoc",
  inbox: "Inbox",
  reports: "Reports",
};

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  const { tab: tabParam } = await searchParams;
  const view: View = (VIEWS as readonly string[]).includes(tabParam ?? "") ? (tabParam as View) : "campaigns";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Outreach</h1>
          <p className="text-sm text-muted-foreground">
            Campaigns, ad-hoc sends, replies, and reports — everything downstream of a qualified lead.
          </p>
        </div>
        {view === "campaigns" && <NewCampaignForm />}
      </div>

      <div className="flex gap-1 border-b">
        {VIEWS.map((v) => (
          <Link
            key={v}
            href={`/campaigns?tab=${v}`}
            className={cn(
              "px-3 py-2 text-sm border-b-2 -mb-px transition-colors",
              v === view ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {VIEW_LABELS[v]}
          </Link>
        ))}
      </div>

      {view === "campaigns" && <CampaignsListView />}
      {view === "adhoc" && <AdhocView />}
      {view === "inbox" && <MasterInboxView />}
      {view === "reports" && <ReportsView searchParams={searchParams} />}
    </div>
  );
}

async function CampaignsListView() {
  const [campaigns, deletedCampaigns] = await Promise.all([listCampaigns(), listDeletedCampaigns()]);
  return (
    <>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Angle</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Versions</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="text-right">Replied</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => (
                <CampaignRow key={c.id} campaign={c} />
              ))}
              {campaigns.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-8">
                    No campaigns yet. Create one, then add leads to it from the Leads page.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {deletedCampaigns.length > 0 && <DeletedCampaignsSection campaigns={deletedCampaigns} />}
    </>
  );
}

// Plain, non-campaign leads that have a working email and haven't been
// contacted yet — campaign-assigned leads are handled entirely by their
// campaign's own Send tab (app/(dashboard)/campaigns/[id]).
async function AdhocView() {
  const sb = createAdminClient();
  const settings = await getSettings();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [{ data: leads }, { count: sentToday }, handoverOutcomes] = await Promise.all([
    sb
      .from("leads")
      .select(
        "id, username, full_name, niche, business_model, funnel_program_name, funnel_offer_summary, external_link, email, email_provider, email_status, email_v2, email_v2_provider, email_v2_status, overall_score, status, outreach_count, parent_username",
      )
      .in("status", ["qualified", "review"])
      .or("outreach_count.is.null,outreach_count.eq.0")
      .is("campaign_id", null)
      .order("overall_score", { ascending: false, nullsFirst: false }),
    sb
      .from("outreach_messages")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent")
      .gte("sent_at", startOfToday.toISOString()),
    getHandoverOutcomesByParent(),
  ]);

  const rows: OutreachRow[] = [];
  for (const lead of leads ?? []) {
    const resolved = resolveReadyEmail(lead);
    if (!resolved) continue;

    const firstName = extractFirstName(lead.full_name) ?? extractFirstNameFromUsername(lead.username);

    rows.push({
      id: lead.id,
      username: lead.username,
      full_name: lead.full_name,
      niche: lead.niche,
      business_model: lead.business_model,
      funnel_program_name: lead.funnel_program_name,
      funnel_offer_summary: lead.funnel_offer_summary,
      external_link: lead.external_link,
      email: resolved.email,
      email_provider: resolved.provider,
      overall_score: lead.overall_score,
      status: lead.status,
      firstName,
      needsFix: !lead.funnel_program_name || firstName === null,
      parent_username: lead.parent_username,
      sourceOutcome: lead.parent_username ? handoverOutcomes.get(lead.parent_username) ?? null : null,
      campaign: null,
    });
  }

  rows.sort((a, b) => {
    if (a.needsFix !== b.needsFix) return a.needsFix ? -1 : 1;
    return (b.overall_score ?? 0) - (a.overall_score ?? 0);
  });

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          <Mail className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No leads are ready for ad-hoc outreach.</p>
          <p className="text-xs mt-1">
            A lead shows up here once it has a working email, hasn&apos;t been contacted yet, and isn&apos;t in a campaign.
          </p>
        </CardContent>
      </Card>
    );
  }

  const templates: CategoryTemplates = {
    partnerships: { subject: settings.outreach_subject_partnerships, body: settings.outreach_body_partnerships },
    info: { subject: settings.outreach_subject_info, body: settings.outreach_body_info },
    other: { subject: settings.outreach_subject_other, body: settings.outreach_body_other },
  };

  return (
    <OutreachReadyClient
      rows={rows}
      inboxRows={[]}
      templates={templates}
      senderName={settings.gmail_from_name}
      sentToday={sentToday ?? 0}
      dryRun={process.env.OUTREACH_DRY_RUN === "1"}
    />
  );
}

// Every reply across every campaign (and non-campaign leads, tagged
// "Non-campaign") — the union of every per-campaign inbox tab, plus what the
// Ad-hoc tab's leads have replied to. Same query (lib/inbox/rows.ts), just
// with no campaignId filter.
async function MasterInboxView() {
  const [rows, settings] = await Promise.all([getInboxRows(createAdminClient()), getSettings()]);
  return (
    <Card>
      <CardContent className="pt-6">
        <CampaignInboxPanel rows={rows} senderName={settings.gmail_from_name} />
      </CardContent>
    </Card>
  );
}

const CANDIDATE_LIMIT = 15;

async function ReportsView({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const sb = createAdminClient();

  const { data: reportRows } = await sb
    .from("reports")
    .select("id, lead_id, status, error, pdf_path, created_at, created_by")
    .order("created_at", { ascending: false })
    .limit(50);

  const rows = reportRows ?? [];

  const leadIds = [...new Set(rows.map((r) => r.lead_id))];
  const { data: reportLeads } = leadIds.length
    ? await sb.from("leads").select("id, username, full_name, followers").in("id", leadIds)
    : { data: [] };
  const leadById = new Map((reportLeads ?? []).map((l) => [l.id, l]));

  const reports: ReportListItem[] = rows.map((row) => {
    const lead = leadById.get(row.lead_id);
    return {
      id: row.id,
      status: row.status,
      note: row.error,
      hasPdf: Boolean(row.pdf_path),
      createdAt: row.created_at,
      createdBy: row.created_by,
      username: lead?.username ?? "(deleted lead)",
      displayName: lead?.full_name ?? null,
    };
  });

  const { data: positiveReplies } = await sb
    .from("inbox_messages")
    .select("lead_id, snippet, received_at")
    .eq("sentiment", "positive")
    .order("received_at", { ascending: false })
    .limit(60);

  const newestReplyByLead = new Map<string, { snippet: string | null; receivedAt: string }>();
  for (const reply of positiveReplies ?? []) {
    if (!newestReplyByLead.has(reply.lead_id)) {
      newestReplyByLead.set(reply.lead_id, { snippet: reply.snippet, receivedAt: reply.received_at });
    }
  }

  const repliedIds = [...newestReplyByLead.keys()];
  const { data: repliedLeadRows } = repliedIds.length
    ? await sb
        .from("leads")
        .select("id, username, full_name, followers, niche, funnel_price, funnel_platform")
        .in("id", repliedIds)
    : { data: [] };

  const leadsWithReports = new Set(rows.map((r) => r.lead_id));

  const replied = (repliedLeadRows ?? [])
    .map((lead) => ({ lead, reply: newestReplyByLead.get(lead.id)! }))
    .sort((a, b) => b.reply.receivedAt.localeCompare(a.reply.receivedAt));

  let candidateQuery = sb
    .from("leads")
    .select("id, username, full_name, followers, niche, overall_score, funnel_price, funnel_platform")
    .eq("status", "qualified")
    .order("overall_score", { ascending: false, nullsFirst: false })
    .limit(CANDIDATE_LIMIT);

  if (query) {
    const safe = query.replace(/[%,]/g, "");
    candidateQuery = candidateQuery.or(
      `username.ilike.%${safe}%,full_name.ilike.%${safe}%,niche.ilike.%${safe}%`,
    );
  }
  const { data: candidates } = await candidateQuery;

  return (
    <div className="space-y-6">
      {replied.length > 0 && (
        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquareHeart className="h-4 w-4 text-emerald-700" />
              Replied positively
              <Badge variant="secondary">{replied.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y rounded-md border bg-background">
              {replied.map(({ lead, reply }) => (
                <div key={lead.id} className="flex items-start justify-between gap-4 p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link href={`/leads/${lead.username}`} className="font-medium hover:underline">
                        @{lead.username}
                      </Link>
                      <span className="text-xs text-muted-foreground">{relativeTime(reply.receivedAt)}</span>
                      {leadsWithReports.has(lead.id) && (
                        <Badge variant="outline" className="text-[10px]">
                          report exists
                        </Badge>
                      )}
                    </div>
                    {reply.snippet && (
                      <p className="mt-1 line-clamp-2 text-sm italic text-muted-foreground">
                        &ldquo;{reply.snippet.trim()}&rdquo;
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[
                        lead.full_name,
                        lead.niche,
                        lead.followers ? `${formatNumber(lead.followers)} followers` : null,
                        lead.funnel_price
                          ? `${lead.funnel_price}${lead.funnel_platform ? ` on ${lead.funnel_platform}` : ""}`
                          : "no price found — deal value will be an assumption",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <GenerateButton leadId={lead.id} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Start a report</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="flex gap-2">
            <input type="hidden" name="tab" value="reports" />
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                name="q"
                defaultValue={query}
                placeholder="Search qualified leads by handle, name, or niche…"
                className="w-full rounded-md border bg-background py-2 pl-8 pr-3 text-sm"
              />
            </div>
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>

          {(candidates ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {query ? `No qualified leads match "${query}".` : "No qualified leads yet."}
            </p>
          ) : (
            <div className="divide-y rounded-md border">
              {(candidates ?? []).map((lead) => (
                <div key={lead.id} className="flex items-center justify-between gap-4 p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link href={`/leads/${lead.username}`} className="font-medium hover:underline">
                        @{lead.username}
                      </Link>
                      {lead.overall_score != null && <Badge variant="secondary">{lead.overall_score}</Badge>}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {[
                        lead.full_name,
                        lead.niche,
                        lead.followers ? `${formatNumber(lead.followers)} followers` : null,
                        lead.funnel_price
                          ? `${lead.funnel_price}${lead.funnel_platform ? ` on ${lead.funnel_platform}` : ""}`
                          : "no price found yet",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <GenerateButton leadId={lead.id} />
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Showing the {CANDIDATE_LIMIT} top-scoring qualified leads. To adjust the financial inputs before
            generating, open the lead and use the report panel there.
          </p>
        </CardContent>
      </Card>

      <ReportsList reports={reports} />
    </div>
  );
}

/** Coarse relative time; a reply's age matters, its exact minute does not. */
function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
