"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Loader2, Check } from "lucide-react";
import { upsertFixedCost, deleteFixedCost, setFixedCostActive } from "@/app/actions/billing";
import type { FixedCost } from "@/lib/billing/summary";

export function FixedCostsEditor({ costs }: { costs: FixedCost[] }) {
  const [pending, start] = useTransition();
  const [newLabel, setNewLabel] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newNote, setNewNote] = useState("");

  function addCost() {
    const amount = parseFloat(newAmount);
    if (!newLabel.trim() || !Number.isFinite(amount)) return;
    start(async () => {
      await upsertFixedCost({ label: newLabel.trim(), monthlyUsd: amount, note: newNote.trim() || null });
      setNewLabel("");
      setNewAmount("");
      setNewNote("");
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {costs.length === 0 && (
          <p className="text-sm text-muted-foreground">No fixed subscriptions yet.</p>
        )}
        {costs.map((c) => (
          <FixedCostRow key={c.id} cost={c} pending={pending} start={start} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <Input
          placeholder="Label (e.g. Vercel)"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          className="w-40"
        />
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={newAmount}
            onChange={(e) => setNewAmount(e.target.value)}
            className="w-28 pl-5"
          />
        </div>
        <Input
          placeholder="Note (optional)"
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          className="w-44"
        />
        <Button size="sm" onClick={addCost} disabled={pending || !newLabel.trim() || !newAmount}>
          {pending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Plus className="h-3 w-3 mr-1" />}
          Add
        </Button>
      </div>
    </div>
  );
}

function FixedCostRow({
  cost,
  pending,
  start,
}: {
  cost: FixedCost;
  pending: boolean;
  start: (cb: () => Promise<void>) => void;
}) {
  const [label, setLabel] = useState(cost.label);
  const [amount, setAmount] = useState(String(cost.monthly_usd));
  const dirty = label !== cost.label || amount !== String(cost.monthly_usd);

  return (
    <div className={`flex flex-wrap items-center gap-2 ${cost.active ? "" : "opacity-50"}`}>
      <input
        type="checkbox"
        checked={cost.active}
        title={cost.active ? "Active — counted in total" : "Inactive"}
        onChange={(e) => start(async () => { await setFixedCostActive(cost.id, e.target.checked); })}
        className="h-4 w-4 accent-current"
      />
      <Input value={label} onChange={(e) => setLabel(e.target.value)} className="w-40" />
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
        <Input
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-28 pl-5"
        />
      </div>
      <span className="text-xs text-muted-foreground flex-1 min-w-[80px]">{cost.note ?? ""}</span>
      <Button
        size="sm"
        variant="outline"
        disabled={pending || !dirty}
        onClick={() => start(async () => {
          await upsertFixedCost({ id: cost.id, label: label.trim(), monthlyUsd: parseFloat(amount) || 0, note: cost.note });
        })}
      >
        <Check className="h-3 w-3 mr-1" /> Save
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => start(async () => { await deleteFixedCost(cost.id); })}
        title="Delete"
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}
