"use client";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Trash2, Loader2, AlertCircle } from "lucide-react";
import { deleteLeads } from "@/app/actions/leads";

type Ctx = {
  allIds: string[];
  selected: Set<string>;
  toggle: (id: string) => void;
  toggleAll: () => void;
  clear: () => void;
};

const SelectionContext = createContext<Ctx>({
  allIds: [],
  selected: new Set(),
  toggle: () => {},
  toggleAll: () => {},
  clear: () => {},
});

export function SelectionProvider({
  allIds,
  children,
}: {
  allIds: string[];
  children: React.ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // When the page of leads changes (navigation, post-delete refresh), drop any
  // selected ids that are no longer present so the toolbar count stays honest.
  const key = allIds.join(",");
  useEffect(() => {
    setSelected((prev) => {
      const present = new Set(allIds);
      const next = new Set<string>();
      for (const id of prev) if (present.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => (prev.size === allIds.length ? new Set() : new Set(allIds)));

  const clear = () => setSelected(new Set());

  const value = useMemo(
    () => ({ allIds, selected, toggle, toggleAll, clear }),
    [allIds, selected],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function SelectAllCheckbox() {
  const { allIds, selected, toggleAll } = useContext(SelectionContext);
  const ref = useRef<HTMLInputElement>(null);
  const all = allIds.length > 0 && selected.size === allIds.length;
  const some = selected.size > 0 && !all;

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some;
  }, [some]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className="h-4 w-4 cursor-pointer rounded border-input accent-primary"
      checked={all}
      onChange={toggleAll}
      disabled={allIds.length === 0}
      aria-label="Select all leads on this page"
    />
  );
}

export function LeadCheckbox({ id }: { id: string }) {
  const { selected, toggle } = useContext(SelectionContext);
  return (
    <input
      type="checkbox"
      className="h-4 w-4 cursor-pointer rounded border-input accent-primary"
      checked={selected.has(id)}
      onChange={() => toggle(id)}
      aria-label="Select lead"
    />
  );
}

export function BulkDeleteBar() {
  const { selected, clear } = useContext(SelectionContext);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const count = selected.size;

  if (count === 0) return null;

  const onDelete = () => {
    const ids = [...selected];
    const ok = window.confirm(
      `Delete ${ids.length} lead${ids.length === 1 ? "" : "s"}? ` +
        `They'll be added to your exclusion list so the scraper won't re-add them.`,
    );
    if (!ok) return;
    setError(null);
    start(async () => {
      const r = await deleteLeads(ids);
      if (r.ok) {
        clear();
        router.refresh();
      } else {
        setError(r.error ?? "delete failed");
      }
    });
  };

  const busy = pending;

  return (
    <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
      <span className="text-sm font-medium tabular-nums">
        {count} selected
      </span>
      <Button variant="destructive" size="sm" onClick={onDelete} disabled={busy}>
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
        )}
        {pending ? "Deleting…" : "Delete selected"}
      </Button>
      <Button variant="ghost" size="sm" onClick={clear} disabled={busy}>
        Clear
      </Button>
      {error && (
        <span className="inline-flex items-center gap-1 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </span>
      )}
    </div>
  );
}
