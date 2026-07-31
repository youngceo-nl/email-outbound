import Link from "next/link";
import { notFound } from "next/navigation";
import { cn } from "@/lib/utils";
import { getCampaign, getCampaignLeads, getCampaignSendQueue } from "@/app/actions/campaigns";
import { getSettings } from "@/lib/config/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { getInboxRows } from "@/lib/inbox/rows";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CampaignHeaderForm } from "@/components/campaigns/campaign-header-form";
import { CampaignReplyTemplateForm } from "@/components/campaigns/campaign-reply-template-form";
import { CampaignVariantEditor } from "@/components/campaigns/campaign-variant-editor";
import { CampaignSendPanel } from "@/components/campaigns/campaign-send-panel";
import { CampaignInboxPanel } from "@/components/campaigns/campaign-inbox-panel";
import { CampaignRestoreBanner } from "@/components/campaigns/campaign-restore-banner";

export const dynamic = "force-dynamic";

const TABS = ["overview", "sequence", "send", "inbox", "leads"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { overview: "Overview", sequence: "Steps", send: "Send", inbox: "Inbox", leads: "Leads" };

function stepStatus(
  lead: { campaign_step: number; last_campaign_send_at: string | null; reply_count: number | null },
  totalSteps: number,
): string {
  if ((lead.reply_count ?? 0) > 0) return "replied — stopped";
  if (totalSteps === 0) return "no steps set up";
  if (lead.campaign_step >= totalSteps) return "all steps sent";
  if (lead.campaign_step === 0) return "ready to send (step 1)";
  return `sent step ${lead.campaign_step} — next one coming up`;
}

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "overview";

  const campaign = await getCampaign(id);
  if (!campaign) notFound();

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link href="/campaigns" className="text-sm text-muted-foreground hover:underline">
          ← Campaigns
        </Link>
      </div>

      {campaign.deleted_at && (
        <CampaignRestoreBanner campaignId={campaign.id} deletedAt={campaign.deleted_at} />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Campaign settings</CardTitle>
        </CardHeader>
        <CardContent>
          <CampaignHeaderForm campaign={campaign} />
        </CardContent>
      </Card>

      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/campaigns/${id}?tab=${t}`}
            className={cn(
              "px-3 py-2 text-sm border-b-2 -mb-px transition-colors",
              t === tab ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {TAB_LABELS[t]}
          </Link>
        ))}
      </div>

      {tab === "overview" && (
        <Card>
          <CardHeader>
            <CardTitle>Stats</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-8 text-sm">
            <div>
              <p className="text-2xl font-semibold tabular-nums">{campaign.assigned_count}</p>
              <p className="text-muted-foreground">Leads</p>
            </div>
            <div>
              <p className="text-2xl font-semibold tabular-nums">{campaign.sent_count}</p>
              <p className="text-muted-foreground">Sent</p>
            </div>
            <div>
              <p className="text-2xl font-semibold tabular-nums">{campaign.replied_count}</p>
              <p className="text-muted-foreground">Replied</p>
            </div>
            <div>
              <p className="text-2xl font-semibold tabular-nums">{campaign.variants.length}</p>
              <p className="text-muted-foreground">Version{campaign.variants.length === 1 ? "" : "s"}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "overview" && (
        <Card>
          <CardHeader>
            <CardTitle>Positive-reply template</CardTitle>
          </CardHeader>
          <CardContent>
            <CampaignReplyTemplateForm campaignId={campaign.id} initialValue={campaign.positive_reply_template} />
          </CardContent>
        </Card>
      )}

      {tab === "sequence" && (
        <Card>
          <CardHeader>
            <CardTitle>Steps</CardTitle>
          </CardHeader>
          <CardContent>
            <CampaignVariantEditor
              campaignId={campaign.id}
              initialVariants={campaign.variants}
              locked={campaign.assigned_count > 0}
            />
          </CardContent>
        </Card>
      )}

      {tab === "send" && <SendTab campaignId={campaign.id} />}

      {tab === "inbox" && <InboxTab campaignId={campaign.id} />}

      {tab === "leads" && (
        <Card>
          <CardHeader>
            <CardTitle>Leads in this campaign</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <LeadsTable campaignId={campaign.id} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

async function SendTab({ campaignId }: { campaignId: string }) {
  const [rows, settings] = await Promise.all([getCampaignSendQueue(campaignId), getSettings()]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Send</CardTitle>
      </CardHeader>
      <CardContent>
        <CampaignSendPanel
          rows={rows}
          senderName={settings.gmail_from_name}
          dryRun={process.env.OUTREACH_DRY_RUN === "1"}
        />
      </CardContent>
    </Card>
  );
}

async function InboxTab({ campaignId }: { campaignId: string }) {
  const [rows, settings] = await Promise.all([
    getInboxRows(createAdminClient(), { campaignId }),
    getSettings(),
  ]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Inbox</CardTitle>
      </CardHeader>
      <CardContent>
        <CampaignInboxPanel rows={rows} senderName={settings.gmail_from_name} />
      </CardContent>
    </Card>
  );
}

async function LeadsTable({ campaignId }: { campaignId: string }) {
  const leads = await getCampaignLeads(campaignId);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Account</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Version</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Last send</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {leads.map((l) => (
          <TableRow key={l.id}>
            <TableCell>
              <Link href={`/leads/${l.username}`} className="font-medium hover:underline">
                @{l.username}
              </Link>
              {l.full_name && <div className="text-xs text-muted-foreground">{l.full_name}</div>}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">{l.email ?? "—"}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{l.variant_label ?? "—"}</TableCell>
            <TableCell className="text-xs">{stepStatus(l, l.variant_step_count)}</TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {l.last_campaign_send_at ? new Date(l.last_campaign_send_at).toLocaleDateString() : "—"}
            </TableCell>
          </TableRow>
        ))}
        {leads.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
              No leads yet — select some on the Leads page and add them to this campaign.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
