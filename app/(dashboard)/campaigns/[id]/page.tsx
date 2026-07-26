import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaign, getCampaignLeads } from "@/app/actions/campaigns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CampaignHeaderForm } from "@/components/campaigns/campaign-header-form";
import { CampaignStepsEditor } from "@/components/campaigns/campaign-steps-editor";

export const dynamic = "force-dynamic";

function stepStatus(
  lead: { campaign_step: number; last_campaign_send_at: string | null; reply_count: number | null },
  totalSteps: number,
): string {
  if ((lead.reply_count ?? 0) > 0) return "replied — stopped";
  if (lead.campaign_step >= totalSteps) return "sequence complete";
  if (lead.campaign_step === 0) return "due now (step 1)";
  return `sent step ${lead.campaign_step} — next due per delay`;
}

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) notFound();

  const leads = await getCampaignLeads(id);

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link href="/campaigns" className="text-sm text-muted-foreground hover:underline">
          ← Campaigns
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Campaign settings</CardTitle>
        </CardHeader>
        <CardContent>
          <CampaignHeaderForm campaign={campaign} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stats</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-8 text-sm">
          <div>
            <p className="text-2xl font-semibold tabular-nums">{campaign.assigned_count}</p>
            <p className="text-muted-foreground">Assigned</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">{campaign.sent_count}</p>
            <p className="text-muted-foreground">Sent</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">{campaign.replied_count}</p>
            <p className="text-muted-foreground">Replied</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sequence</CardTitle>
        </CardHeader>
        <CardContent>
          <CampaignStepsEditor campaignId={campaign.id} initialSteps={campaign.steps} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assigned leads</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Email</TableHead>
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
                  <TableCell className="text-xs">{stepStatus(l, campaign.steps.length)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {l.last_campaign_send_at ? new Date(l.last_campaign_send_at).toLocaleDateString() : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {leads.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">
                    No leads assigned yet — select some on the Leads page and assign them to this campaign.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
