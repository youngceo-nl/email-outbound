"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, AlertCircle, CheckCircle2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { upsertCampaignVariants, type VariantInput } from "@/app/actions/campaigns";
import { CampaignStepsEditor } from "./campaign-steps-editor";
import type { CampaignVariantWithSteps } from "@/app/actions/campaigns";
import { rebalanceOnChange, rebalanceOnRemove } from "@/lib/campaigns/rebalance";

export function CampaignVariantEditor({
  campaignId,
  initialVariants,
  locked,
}: {
  campaignId: string;
  initialVariants: CampaignVariantWithSteps[];
  locked: boolean;
}) {
  const [variants, setVariants] = useState<(VariantInput & { steps?: CampaignVariantWithSteps["steps"] })[]>(
    initialVariants.map((v) => ({ id: v.id, label: v.label, weight_pct: v.weight_pct, steps: v.steps })),
  );
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  const total = variants.reduce((sum, v) => sum + (v.weight_pct || 0), 0);

  const updateLabel = (i: number, label: string) =>
    setVariants((prev) => prev.map((v, idx) => (idx === i ? { ...v, label } : v)));

  // Redistributes every other variant's weight_pct proportionally so the
  // total always stays exactly 100 (see lib/campaigns/rebalance.ts) — no more
  // manually retyping the rest of the split to make it add up.
  const updateWeight = (i: number, requestedValue: number) =>
    setVariants((prev) => {
      const rebalanced = rebalanceOnChange(prev.map((v) => v.weight_pct), i, requestedValue);
      return prev.map((v, idx) => ({ ...v, weight_pct: rebalanced[idx] }));
    });

  const addVariant = () => {
    const nextLabel = String.fromCharCode(65 + variants.length); // A, B, C, …
    setVariants((prev) => {
      const withNew = [...prev, { label: nextLabel, weight_pct: 0 }];
      // Give the new variant 1%, taken proportionally from the existing ones,
      // so the list is never sitting at an invalid (non-100) total.
      const rebalanced = rebalanceOnChange(withNew.map((v) => v.weight_pct), withNew.length - 1, 1);
      return withNew.map((v, idx) => ({ ...v, weight_pct: rebalanced[idx] }));
    });
  };

  const removeVariant = (i: number) =>
    setVariants((prev) => {
      const rebalanced = rebalanceOnRemove(prev.map((v) => v.weight_pct), i);
      return prev.filter((_, idx) => idx !== i).map((v, idx) => ({ ...v, weight_pct: rebalanced[idx] }));
    });

  const save = () => {
    setError(null);
    setSaved(false);
    start(async () => {
      const r = await upsertCampaignVariants(
        campaignId,
        variants.map(({ id, label, weight_pct }) => ({ id, label, weight_pct })),
      );
      if (r.ok) {
        setSaved(true);
        // A newly-added variant has no id until this point — splice the
        // real ones back in (same order as what was sent) so it stops
        // looking permanently unsaved and its step editor can unlock.
        if (r.ids) {
          setVariants((prev) => prev.map((v, idx) => ({ ...v, id: r.ids![idx] })));
        }
        router.refresh();
      } else {
        setError(r.error ?? "Save failed");
      }
    });
  };

  return (
    <div className="space-y-6">
      {locked && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-md border bg-muted/30 px-3 py-2">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          Leads are already in this campaign — versions (add/remove/split %) are locked.
          Step copy within each existing version can still be edited.
        </div>
      )}

      <div className="space-y-3">
        {variants.map((v, i) => (
          <div key={v.id ?? `new-${i}`} className="flex items-center gap-2">
            <Input
              value={v.label}
              onChange={(e) => updateLabel(i, e.target.value)}
              disabled={locked}
              className="w-20"
              placeholder="Label"
            />
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                min={1}
                max={100}
                value={v.weight_pct}
                onChange={(e) => updateWeight(i, Number(e.target.value) || 0)}
                disabled={locked || variants.length < 2}
                className="w-20"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
            <div className="flex-1 h-2 bg-muted rounded overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, v.weight_pct))}%` }} />
            </div>
            {!locked && variants.length > 1 && (
              <button
                type="button"
                onClick={() => removeVariant(i)}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Remove variant ${v.label}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}

        {!locked && (
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={addVariant}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Add a version (A/B test)
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={pending}>
              {pending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              {pending ? "Saving…" : "Save versions"}
            </Button>
            <span className="text-xs text-muted-foreground">{total}% total</span>
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
        )}
      </div>

      <div className="space-y-4">
        {variants.filter((v) => v.id).map((v) => (
          <div key={v.id} className="rounded-lg border p-4 space-y-3">
            <p className="text-sm font-semibold">Version {v.label} — {v.weight_pct}%</p>
            <CampaignStepsEditor variantId={v.id!} initialSteps={v.steps ?? []} />
          </div>
        ))}
        {variants.some((v) => !v.id) && (
          <p className="text-xs text-muted-foreground">
            Save the new version above before adding its steps.
          </p>
        )}
      </div>
    </div>
  );
}
