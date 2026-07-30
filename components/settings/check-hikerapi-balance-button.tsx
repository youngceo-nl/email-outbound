"use client";
import { useState, useTransition } from "react";
import { Check, AlertCircle, Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkHikerApiBalance } from "@/app/actions/check-hikerapi-balance";

export function CheckHikerApiBalanceButton() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string; amount?: number } | null>(null);

  const onClick = () => {
    setResult(null);
    start(async () => {
      const r = await checkHikerApiBalance();
      setResult({ ok: r.ok, message: r.message, amount: r.amount });
    });
  };

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" size="sm" onClick={onClick} disabled={pending}>
        {pending ? (
          <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Checking…</>
        ) : (
          <><Wallet className="h-3 w-3 mr-1" /> Check balance</>
        )}
      </Button>
      {result && (
        <div
          className={`text-xs flex items-start gap-2 rounded border px-3 py-2 ${
            result.ok
              ? result.amount !== undefined && result.amount <= 0
                ? "border-amber-300 bg-amber-50 text-amber-900"
                : "border-green-300 bg-green-50 text-green-900"
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
            {result.ok && result.amount !== undefined && result.amount <= 0 && (
              <p className="text-muted-foreground mt-0.5">Balance is $0 — top up on the HikerAPI dashboard before scraping.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
