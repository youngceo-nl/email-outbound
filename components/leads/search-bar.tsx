"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

export function LeadsSearchBar({ initial }: { initial?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initial ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep in sync when URL changes externally (e.g. clear filters)
  useEffect(() => {
    setValue(initial ?? "");
  }, [initial]);

  const push = (v: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (v) {
      params.set("search", v);
    } else {
      params.delete("search");
    }
    params.delete("page");
    router.push(`/leads?${params.toString()}`);
  };

  const handleChange = (v: string) => {
    setValue(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => push(v), 300);
  };

  const clear = () => {
    setValue("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    push("");
  };

  return (
    <div className="relative w-64">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      <Input
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Search by handle or name…"
        className="pl-8 pr-7 h-9 text-sm"
        onKeyDown={(e) => {
          if (e.key === "Escape") clear();
        }}
      />
      {value && (
        <button
          onClick={clear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
