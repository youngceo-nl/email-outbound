"use client";
import { useState, useTransition } from "react";
import { Check, AlertCircle, Loader2, Cookie } from "lucide-react";
import { Button } from "@/components/ui/button";
import { testIgCookie } from "@/app/actions/test-ig-cookie";

export function TestCookieButton() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string; followers?: number } | null>(null);

  const onClick = () => {
    setResult(null);
    start(async () => {
      const r = await testIgCookie();
      setResult({
        ok: r.ok,
        message: r.message,
        followers: r.detail?.followers,
      });
    });
  };

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" size="sm" onClick={onClick} disabled={pending}>
        {pending ? (
          <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Testing…</>
        ) : (
          <><Cookie className="h-3 w-3 mr-1" /> Test cookie</>
        )}
      </Button>
      {result && (
        <div
          className={`text-xs flex items-start gap-2 rounded border px-3 py-2 ${
            result.ok
              ? "border-green-300 bg-green-50 text-green-900"
              : "border-red-300 bg-red-50 text-red-900"
          }`}
        >
          {result.ok ? (
            <Check className="h-3.5 w-3.5 mt-0.5 shrink-0 text-green-600" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-600" />
          )}
          <div>
            <p>{result.message}</p>
            {result.followers != null && (
              <p className="text-muted-foreground mt-0.5">probed account has {result.followers.toLocaleString()} followers</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
