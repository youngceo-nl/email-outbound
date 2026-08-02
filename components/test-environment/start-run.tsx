"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Play, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { startTestRun, type PreflightCheck } from "@/app/actions/test-environment";
import { cn } from "@/lib/utils";

export function StartRun({ preflight }: { preflight: PreflightCheck[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [usernames, setUsernames] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const blockers = preflight.filter((c) => c.blocking && !c.ok);
  const count = usernames.split(/[\s,]+/).filter(Boolean).length;

  const submit = () => {
    if (pending || count === 0) return;
    setError(null);
    start(async () => {
      const res = await startTestRun({ label, usernames });
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
        <Textarea
          value={usernames}
          onChange={(e) => setUsernames(e.target.value)}
          placeholder={"Instagram usernames or URLs, one per line"}
          className="min-h-[120px] font-mono text-xs"
        />

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={pending || count === 0}>
            {pending ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-1.5" />
            )}
            Start run{count > 0 && ` (${count})`}
          </Button>
          <span className="text-xs text-muted-foreground">
            Acquisition runs one lead at a time, so a batch takes roughly a minute per lead.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
