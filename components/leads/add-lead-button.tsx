"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Loader2, Check, AlertCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { addLead } from "@/app/actions/leads";

export function AddLeadButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ username: string; analyzing: boolean; existed: boolean } | null>(null);

  const reset = () => {
    setError(null);
    setResult(null);
  };

  const onSubmit = (formData: FormData) => {
    reset();
    start(async () => {
      const res = await addLead(formData);
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.");
        return;
      }
      if (res.error) setError(res.error);
      setResult({
        username: res.username!,
        analyzing: res.analyzing ?? false,
        existed: res.already_existed ?? false,
      });
      if (res.analyzing) {
        window.dispatchEvent(new CustomEvent("open-activity-drawer", { detail: {} }));
      }
      router.refresh();
    });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <PopoverTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" /> Add lead
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-4">
        {result ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm">
              <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">
                  {result.existed ? "Already in your leads" : "Lead added"}
                </p>
                <p className="text-muted-foreground text-xs mt-0.5">
                  {result.analyzing
                    ? "Scraping & scoring now — check the Activity drawer for progress."
                    : "Added to your pipeline."}
                </p>
              </div>
            </div>
            {error && (
              <p className="text-xs text-amber-600 flex items-start gap-1">
                <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button asChild size="sm" className="flex-1">
                <Link href={`/leads/${result.username}`}>
                  View @{result.username} <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                </Link>
              </Button>
              <Button size="sm" variant="outline" onClick={reset}>
                Add another
              </Button>
            </div>
          </div>
        ) : (
          <form action={onSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="add-lead-input" className="text-sm font-medium">Add a lead manually</Label>
              <Input
                id="add-lead-input"
                name="input"
                autoFocus
                autoComplete="off"
                placeholder="@username  or  instagram.com/username"
                required
              />
              <p className="text-xs text-muted-foreground">Enter an Instagram username or profile URL.</p>
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" name="analyze" defaultChecked className="h-4 w-4 rounded border-input" />
              Scrape &amp; score it right away
            </label>

            {error && (
              <p className="text-xs text-destructive flex items-start gap-1">
                <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                {error}
              </p>
            )}

            <Button type="submit" disabled={pending} className="w-full">
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Adding…
                </>
              ) : (
                "Add lead"
              )}
            </Button>
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
}
