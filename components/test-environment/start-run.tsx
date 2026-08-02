"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Play, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  startSourcedTestRun,
  startTestRun,
  type PreflightCheck,
  type SeedOption,
} from "@/app/actions/test-environment";
import { cn } from "@/lib/utils";

export function StartRun({ preflight, seeds }: { preflight: PreflightCheck[]; seeds: SeedOption[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [usernames, setUsernames] = useState("");
  const [mode, setMode] = useState<"paste" | "seed">("paste");
  const [seedUsername, setSeedUsername] = useState(seeds[0]?.username ?? "");
  const [limit, setLimit] = useState("20");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const blockers = preflight.filter((c) => c.blocking && !c.ok);
  const count = usernames.split(/[\s,]+/).filter(Boolean).length;
  const limitNum = Number(limit) || 0;
  const canStart = mode === "paste" ? count > 0 : !!seedUsername && limitNum > 0;

  const submit = () => {
    if (pending || !canStart) return;
    setError(null);
    start(async () => {
      const res =
        mode === "paste"
          ? await startTestRun({ label, usernames })
          : await startSourcedTestRun({ label, seedUsername, limit: limitNum });
      if (!res.ok) return setError(res.error);
      router.push(`/test-environment/${res.runId}`);
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Start a test run</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Every failure below is silent at runtime, so it is worth stating up
            front rather than after the money is spent. */}
        <div className="grid gap-1.5">
          {preflight.map((check) => (
            <div key={check.label} className="flex items-start gap-2 text-xs">
              {check.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-green-600 dark:text-green-400" />
              ) : (
                <XCircle
                  className={cn(
                    "h-3.5 w-3.5 mt-0.5 shrink-0",
                    check.blocking ? "text-destructive" : "text-yellow-600 dark:text-yellow-400",
                  )}
                />
              )}
              <span className="min-w-0">
                <span className="font-medium">{check.label}</span>
                <span className="text-muted-foreground"> — {check.detail}</span>
              </span>
            </div>
          ))}
        </div>

        {blockers.length > 0 && (
          <p className="text-xs text-destructive">
            {blockers.length} blocking issue{blockers.length > 1 ? "s" : ""} — a run started now
            would fail on every lead.
          </p>
        )}

        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Run name, e.g. &quot;fresh leads batch 1&quot;"
        />
        <div className="flex gap-1">
          {(["paste", "seed"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "px-2.5 py-1 rounded-md border text-xs transition-colors",
                m === mode ? "bg-accent font-medium" : "hover:bg-accent/50 text-muted-foreground",
              )}
            >
              {m === "paste" ? "Paste usernames" : "Source fresh from a seed"}
            </button>
          ))}
        </div>

        {mode === "paste" ? (
          <Textarea
            value={usernames}
            onChange={(e) => setUsernames(e.target.value)}
            placeholder={"Instagram usernames or URLs, one per line"}
            className="min-h-[120px] font-mono text-xs"
          />
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <select
                value={seedUsername}
                onChange={(e) => setSeedUsername(e.target.value)}
                className="flex-1 h-9 rounded-md border bg-background px-2 text-sm"
              >
                {seeds.map((seed) => (
                  <option key={seed.id} value={seed.username}>
                    @{seed.username}
                    {seed.following_count ? ` — ${seed.following_count.toLocaleString()} following` : ""}
                  </option>
                ))}
              </select>
              <Input
                value={limit}
                onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, ""))}
                className="w-24"
                placeholder="20"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Scrapes the seed&apos;s following list via Apify, saves every new account, then
              qualifies the first {limitNum || 0} that have never been scored. Apify credit is
              spent here — the rest of the pipeline is Steel.
            </p>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={pending || !canStart}>
            {pending ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-1.5" />
            )}
            {pending && mode === "seed" ? "Sourcing…" : "Start run"}
            {mode === "paste" && count > 0 && ` (${count})`}
            {mode === "seed" && limitNum > 0 && ` (${limitNum})`}
          </Button>
          <span className="text-xs text-muted-foreground">
            Acquisition runs one lead at a time, so a batch takes roughly a minute per lead.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
