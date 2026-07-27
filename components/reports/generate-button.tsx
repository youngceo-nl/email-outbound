"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { generateReportForLead } from "@/app/actions/reports";

/*
 * Generate opens a small menu, not a run. Three optional prices — entry, main
 * offer, backend — and a generate action. Anything left blank is researched:
 * their offer page is scraped, live competitor pricing is searched for the
 * niche, and the report states which of the two each figure came from. Anything
 * typed here outranks all of that, enters the model at the human tier, and is
 * printed as "confirmed by the team".
 */

/**
 * Creates the report row, then drives the run from the browser.
 *
 * The fetch is awaited so the serverless function stays alive for the whole
 * generation; a caller that fired and forgot would frequently see the work
 * killed mid-flight. With research on, a run takes minutes, not seconds — the
 * row shows progress state while this request is held open.
 */
async function createThenRun(leadId: string, formData: FormData): Promise<string | null> {
  const created = await generateReportForLead(leadId, formData);
  if (!created.ok) {
    window.alert(created.error);
    return null;
  }
  const response = await fetch(`/api/reports/${created.reportId}/generate`, { method: "POST" });
  if (!response.ok && response.status !== 409) {
    const body = await response.json().catch(() => null);
    // The row still exists and shows its own failure state, so this is a nudge
    // rather than the only record of what went wrong.
    window.alert(body?.note ?? "Generation failed — see the report row for details.");
  }
  return created.reportId;
}

const FIELDS = [
  {
    name: "ladder_low_price",
    label: "Low ticket",
    hint: "entry product — membership, app, mini-course",
    placeholder: "e.g. 47",
  },
  {
    name: "front_end_price",
    label: "Mid ticket",
    hint: "what the webinar sells at checkout",
    placeholder: "e.g. 997",
  },
  {
    name: "backend_offer_price",
    label: "High ticket",
    hint: "the private backend offer",
    placeholder: "e.g. 5000",
  },
] as const;

export function GenerateButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function generate() {
    const formData = new FormData();
    for (const field of FIELDS) {
      const value = values[field.name]?.trim();
      if (value) formData.set(field.name, value);
    }
    setOpen(false);
    startTransition(async () => {
      await createThenRun(leadId, formData);
      router.refresh();
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" disabled={pending} className="shrink-0">
          {pending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          {pending ? "Generating…" : "Generate"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium">Offer prices</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Optional. Anything blank is researched — their offer page first, then live competitor pricing for the
              niche.
            </p>
          </div>
          {FIELDS.map((field) => (
            <div key={field.name} className="space-y-1">
              <Label htmlFor={`gen-${field.name}`} className="text-xs">
                {field.label}
                <span className="text-muted-foreground font-normal"> — {field.hint}</span>
              </Label>
              <Input
                id={`gen-${field.name}`}
                inputMode="decimal"
                placeholder={field.placeholder}
                value={values[field.name] ?? ""}
                onChange={(event) => setValues((prev) => ({ ...prev, [field.name]: event.target.value }))}
                className="h-8"
              />
            </div>
          ))}
          <Button size="sm" className="w-full" onClick={generate} disabled={pending}>
            {Object.values(values).some((v) => v.trim())
              ? "Generate with these prices"
              : "Generate — research prices for me"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
