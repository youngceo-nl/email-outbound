"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { upsertVariantSteps, type StepInput } from "@/app/actions/campaigns";
import type { CampaignStep } from "@/lib/types";

const TOKEN_HINT =
  "Tokens: {{first_name}}, {{name}}, {{full_name}}, {{username}}, {{niche}}, {{business_model}}, {{program_name}}, {{offer_summary}}, {{external_link}}, {{sender_name}} — {{key|fallback}} for a fallback.";

export function CampaignStepsEditor({
  variantId,
  initialSteps,
}: {
  variantId: string;
  initialSteps: CampaignStep[];
}) {
  const [steps, setSteps] = useState<StepInput[]>(
    initialSteps.length
      ? initialSteps.map((s) => ({
          step_number: s.step_number,
          delay_days: s.delay_days,
          subject_template: s.subject_template,
          body_template: s.body_template,
        }))
      : [{ step_number: 1, delay_days: 0, subject_template: "", body_template: "" }],
  );
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  const update = (i: number, patch: Partial<StepInput>) =>
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const addStep = () =>
    setSteps((prev) => [
      ...prev,
      { step_number: prev.length + 1, delay_days: 4, subject_template: "", body_template: "" },
    ]);

  const removeStep = (i: number) => setSteps((prev) => prev.filter((_, idx) => idx !== i));

  const save = () => {
    setError(null);
    setSaved(false);
    start(async () => {
      const r = await upsertVariantSteps(variantId, steps);
      if (r.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(r.error ?? "Save failed");
      }
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{TOKEN_HINT}</p>
      {steps.map((s, i) => (
        <div key={i} className="rounded-md border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              Step {i + 1}
              {i === 0 ? " (initial send)" : " (follow-up)"}
            </p>
            {steps.length > 1 && (
              <button
                type="button"
                onClick={() => removeStep(i)}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Remove step ${i + 1}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {i > 0 && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Send
              <Input
                type="number"
                min={0}
                value={s.delay_days}
                onChange={(e) => update(i, { delay_days: Number(e.target.value) || 0 })}
                className="h-7 w-20"
              />
              days after the previous step
            </label>
          )}
          <Input
            placeholder="Subject"
            value={s.subject_template}
            onChange={(e) => update(i, { subject_template: e.target.value })}
          />
          <Textarea
            placeholder="Body"
            value={s.body_template}
            onChange={(e) => update(i, { body_template: e.target.value })}
            className="min-h-[120px] font-mono text-xs"
          />
        </div>
      ))}

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addStep}>
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add follow-up step
        </Button>
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          {pending ? "Saving…" : "Save steps"}
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
