"use client";
import { useState, useTransition } from "react";
import { Search, Plus, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { discoverSeeds, addSeed, type DiscoveredSeedResult } from "@/app/actions/seeds";
import Link from "next/link";

const PRESET_KEYWORDS = [
  "info operator",
  "course creator",
  "online coach",
  "coaching program",
  "digital course",
  "online business",
];

const DEFAULT_SELECTED = new Set(["info operator", "course creator", "online coach"]);

export function SeedDiscovery({ existingSeedUsernames, serperConfigured }: {
  existingSeedUsernames: string[];
  serperConfigured: boolean;
}) {
  const existingSet = new Set(existingSeedUsernames);
  const [selected, setSelected] = useState<Set<string>>(new Set(DEFAULT_SELECTED));
  const [custom, setCustom] = useState("");
  const [results, setResults] = useState<DiscoveredSeedResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [searching, startSearch] = useTransition();
  const [adding, startAdd] = useTransition();

  const toggleKeyword = (kw: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(kw)) next.delete(kw); else next.add(kw);
      return next;
    });
  };

  const handleSearch = () => {
    const all = [...selected];
    if (custom.trim()) all.push(...custom.split(",").map((k) => k.trim()).filter(Boolean));
    if (all.length === 0) { setError("Select at least one keyword."); return; }
    setError(null);
    setResults(null);
    startSearch(async () => {
      const res = await discoverSeeds({ keywords: all.join(", ") });
      if ("error" in res) { setError(res.error); return; }
      setResults(res.results);
    });
  };

  const handleAdd = (username: string) => {
    startAdd(async () => {
      const fd = new FormData();
      fd.set("input", username);
      const res = await addSeed(fd);
      if (!("error" in res) || !res.error) {
        setAdded((prev) => new Set([...prev, username]));
      }
    });
  };

  if (!serperConfigured) {
    return (
      <p className="text-sm text-muted-foreground">
        Serper API key not configured.{" "}
        <Link href="/settings" className="underline">Add it in Settings</Link>{" "}
        to enable automated seed discovery.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground font-medium">Keywords — Google searches Instagram for accounts mentioning these</p>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_KEYWORDS.map((kw) => (
              <button
                key={kw}
                type="button"
                onClick={() => toggleKeyword(kw)}
                className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium border transition-colors cursor-pointer
                  ${selected.has(kw)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted text-muted-foreground border-input hover:bg-accent hover:text-accent-foreground"
                  }`}
              >
                {selected.has(kw) && <Check className="h-3 w-3 mr-1 shrink-0" />}
                {kw}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <Input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Custom keywords, comma-separated…"
            className="flex-1 text-sm"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSearch(); } }}
          />
          <Button onClick={handleSearch} disabled={searching} size="sm">
            <Search className="h-3.5 w-3.5 mr-1.5" />
            {searching ? "Searching…" : "Search"}
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {results !== null && (
        <div className="space-y-2">
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Instagram profiles found. Try different keywords.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">{results.length} account{results.length !== 1 ? "s" : ""} found — review and add the ones that look right</p>
              <div className="rounded-md border divide-y">
                {results.map((r) => {
                  const isAdded = existingSet.has(r.username) || added.has(r.username);
                  return (
                    <div key={r.username} className="flex items-start gap-3 p-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-sm">@{r.username}</span>
                          <a
                            href={`https://www.instagram.com/${r.username}/`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted-foreground hover:text-foreground"
                            title="Open on Instagram"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                        {r.snippet && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{r.snippet}</p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant={isAdded ? "ghost" : "secondary"}
                        disabled={isAdded || adding}
                        onClick={() => handleAdd(r.username)}
                        className="shrink-0"
                      >
                        {isAdded ? (
                          <><Check className="h-3.5 w-3.5 mr-1" />Added</>
                        ) : (
                          <><Plus className="h-3.5 w-3.5 mr-1" />Add as seed</>
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
