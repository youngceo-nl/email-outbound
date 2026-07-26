import Link from "next/link";
import { listCampaigns } from "@/app/actions/campaigns";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { NewCampaignForm } from "@/components/campaigns/new-campaign-form";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const campaigns = await listCampaigns();

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

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Angle</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Steps</TableHead>
                <TableHead className="text-right">Assigned</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="text-right">Replied</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/campaigns/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.angle ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={c.status === "active" ? "default" : "outline"}>{c.status}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.steps.length}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.assigned_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.sent_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.replied_count}</TableCell>
                </TableRow>
              ))}
              {campaigns.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                    No campaigns yet. Create one, then bulk-assign leads to it from the Leads page.
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
