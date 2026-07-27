import { listCampaigns, listDeletedCampaigns } from "@/app/actions/campaigns";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/config/settings";
import { getInboxRows } from "@/lib/inbox/rows";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NewCampaignForm } from "@/components/campaigns/new-campaign-form";
import { CampaignRow } from "@/components/campaigns/campaign-row";
import { DeletedCampaignsSection } from "@/components/campaigns/deleted-campaigns-section";
import { CampaignInboxPanel } from "@/components/campaigns/campaign-inbox-panel";

export const dynamic = "force-dynamic";

const VIEWS = ["campaigns", "inbox"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABELS: Record<View, string> = { campaigns: "Campaigns", inbox: "Inbox" };

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: tabParam } = await searchParams;
  const view: View = (VIEWS as readonly string[]).includes(tabParam ?? "") ? (tabParam as View) : "campaigns";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="text-sm text-muted-foreground">
            Group leads into a named sequence — angle, follow-up steps, and stats. Sending stays manual from Outreach Ready.
          </p>
        </div>
        <NewCampaignForm />
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
      {view === "inbox" && <MasterInboxView />}
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
                <TableHead>Variants</TableHead>
                <TableHead className="text-right">Assigned</TableHead>
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
                    No campaigns yet. Create one, then bulk-assign leads to it from the Leads page.
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

// Every reply across every campaign (and non-campaign leads, tagged
// "Non-campaign") — the union of every per-campaign inbox tab, plus
// whatever Outreach Ready's inbox also shows. Same query
// (lib/inbox/rows.ts), just with no campaignId filter.
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
