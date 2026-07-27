"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { updateCampaign } from "@/app/actions/campaigns";

// Authored once per campaign, shown to the VA in the inbox the moment a
// reply on this campaign is classified 'positive' — see
// docs/instantly-fying-outreachpage/leadpipelinetocampaign.md and
// InboxDetail's compose box. Same {{placeholder}} syntax as outreach
// templates (lib/outreach/template.ts).
export function CampaignReplyTemplateForm({
  campaignId,
  initialValue,
}: {
  campaignId: string;
  initialValue: string | null;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  const save = () => {
    setError(null);
    setSaved(false);
    start(async () => {
      const r = await updateCampaign(campaignId, { positive_reply_template: value });
      if (r.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(r.error ?? "Save failed");
      }
    });
  };

  return (
    <div className="space-y-2">
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={`Hey {{first_name}} - no worries, thanks for getting back to me!\n\nWe just recorded a quick breakdown of a previous case study...`}
        rows={6}
        className="text-sm"
      />
      <p className="text-xs text-muted-foreground">
        Shown to the VA in this campaign's inbox whenever a reply is classified positive. Supports the same
        {" "}
        <code className="text-[11px]">{"{{first_name}}"}</code> / <code className="text-[11px]">{"{{program_name}}"}</code>
        {" "}placeholders as outreach templates.
      </p>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={save} disabled={pending}>
          {pending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          Save template
        </Button>
        {saved && !pending && (
          <span className="inline-flex items-center gap-1 text-xs text-green-600">
            <CheckCircle2 className="h-3.5 w-3.5" /> Saved
          </span>
        )}
        {error && (
          <span className="inline-flex items-center gap-1 text-xs text-red-600">
            <AlertCircle className="h-3.5 w-3.5" /> {error}
          </span>
        )}
      </div>
    </div>
  );
}
