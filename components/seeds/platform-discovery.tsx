"use client";
import { useState, useTransition } from "react";
import { Search, Plus, Check, ExternalLink, ChevronDown, ChevronUp, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  discoverSeedsFromCommunities,
  addSeed,
  type PlatformSeedResult,
  type PlatformCommunity,
} from "@/app/actions/seeds";

const SKOOL_PRESETS: { name: string; description: string; slug: string }[] = [
  { name: "Wholesaling Real Estate", description: "", slug: "wholesaling" },
  { name: "Agency Owners", description: "", slug: "agencyowners" },
  { name: "Synthesizer: Free Skool Growth", description: "", slug: "synthesizer" },
  { name: "Wholesale Vacant Land", description: "", slug: "wienerbros" },
  { name: "High Ticket Sales Training", description: "", slug: "high-ticket-sales-training" },
  { name: "Agency Coach Community", description: "", slug: "agencycoach" },
  { name: "Closers Inner Circle", description: "", slug: "closers-circle" },
  { name: "AI Automation Society Plus", description: "", slug: "ai-automation-society-plus" },
  { name: "Agentic AI for Founders", description: "", slug: "agentic-ai-for-founders" },
  { name: "Maker School: AI Automation", description: "", slug: "makerschool" },
  { name: "School of Mentors", description: "", slug: "schoolofmentors" },
  { name: "Facebook Ads Mastery", description: "", slug: "facebookads" },
  { name: "Origins Ecommerce", description: "", slug: "origins" },
  { name: "SCALE - AI for DTC & Agencies", description: "", slug: "scale-ai" },
  { name: "Gym Exit", description: "", slug: "gymexit" },
];

type Platform = "Skool" | "Whop";

function parseSkoolText(raw: string): PlatformCommunity[] {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      // Accept either "slug" or "Community Name | slug"
      const parts = line.split("|").map((p) => p.trim());
      if (parts.length === 1) {
        // Could be a slug or a name — treat as slug if no spaces, else name only
        const val = parts[0];
        const slug = val.includes(" ") ? undefined : val;
        return { name: slug ?? val, slug, platform: "Skool" as Platform };
      }
      const [name, slug] = parts;
      return { name, slug: slug || undefined, platform: "Skool" as Platform };
    })
    .filter((c) => c.name.length > 0);
}

function parseWhopText(raw: string): PlatformCommunity[] {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      // Accept full URLs or slugs
      let slug = line;
      let name = line;
      if (line.startsWith("http")) {
        try {
          const u = new URL(line);
          slug = u.pathname.replace(/^\/|\/$/g, "");
          name = slug;
        } catch {}
      }
      return { name, slug, platform: "Whop" as Platform };
    })
    .filter((c) => c.slug && c.slug.length > 0);
}

function SourceBadge({ source }: { source: "page" | "serper" }) {
  if (source === "page") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 border border-emerald-200 bg-emerald-50 rounded-full px-2 py-0.5">
        <Globe className="h-3 w-3" />
        direct
      </span>
    );
  }
  return (
    <span className="text-xs text-muted-foreground border rounded-full px-2 py-0.5">
      via search
    </span>
  );
}

export function PlatformDiscovery({
  existingSeedUsernames,
}: {
  existingSeedUsernames: string[];
}) {
  const existingSet = new Set(existingSeedUsernames);
  const [activePlatform, setActivePlatform] = useState<Platform>("Skool");
  const [skoolText, setSkoolText] = useState("");
  const [whopText, setWhopText] = useState("");
  const [showPresets, setShowPresets] = useState(false);
  const [results, setResults] = useState<PlatformSeedResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [searching, startSearch] = useTransition();
  const [adding, startAdd] = useTransition();

  const activeText = activePlatform === "Skool" ? skoolText : whopText;
  const setActiveText = activePlatform === "Skool" ? setSkoolText : setWhopText;

  const handleSearch = () => {
    const communities =
      activePlatform === "Skool"
        ? parseSkoolText(skoolText)
        : parseWhopText(whopText);

    if (communities.length === 0) {
      setError(activePlatform === "Skool"
        ? "Enter at least one community slug (e.g. agencyowners)."
        : "Enter at least one Whop URL or slug.");
      return;
    }
    if (communities.length > 25) { setError("Max 25 at once."); return; }
    setError(null);
    setResults(null);
    startSearch(async () => {
      const res = await discoverSeedsFromCommunities(communities);
      if ("error" in res) { setError(res.error); return; }
      setResults(res.results);
    });
  };

  const handleAdd = (username: string) => {
    startAdd(async () => {
      const fd = new FormData();
      fd.set("input", username);
      await addSeed(fd);
      setAdded((prev) => new Set([...prev, username]));
    });
  };

  const loadAllPresets = () => {
    setSkoolText(SKOOL_PRESETS.map((p) => `${p.name} | ${p.slug}`).join("\n"));
    setShowPresets(false);
  };

  return (
    <div className="space-y-4">
      {/* Platform tabs */}
      <div className="flex gap-1 border-b">
        {(["Skool", "Whop"] as Platform[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => { setActivePlatform(p); setResults(null); setError(null); }}
            className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activePlatform === p
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {activePlatform === "Skool" ? (
          <p className="text-xs text-muted-foreground">
            Enter community slugs, one per line (e.g. <code className="bg-muted px-1 rounded">agencyowners</code>).
            Optionally prefix with a name: <code className="bg-muted px-1 rounded">Agency Owners | agencyowners</code>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Paste Whop seller URLs or slugs, one per line (e.g. <code className="bg-muted px-1 rounded">https://whop.com/some-product/</code> or just <code className="bg-muted px-1 rounded">some-product</code>).
          </p>
        )}

        <Textarea
          value={activeText}
          onChange={(e) => setActiveText(e.target.value)}
          placeholder={
            activePlatform === "Skool"
              ? "agencyowners\nwholesaling\nfacebookads"
              : "https://whop.com/some-seller/\nanother-seller"
          }
          rows={5}
          className="text-sm font-mono resize-y"
        />

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            onClick={handleSearch}
            disabled={searching || activeText.trim().length === 0}
            size="sm"
          >
            <Search className="h-3.5 w-3.5 mr-1.5" />
            {searching ? "Searching…" : "Find Instagram accounts"}
          </Button>

          {activePlatform === "Skool" && (
            <button
              type="button"
              onClick={() => setShowPresets((v) => !v)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPresets ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Top Skool ICP presets
            </button>
          )}
        </div>

        {showPresets && activePlatform === "Skool" && (
          <div className="rounded-md border bg-muted/40 p-3 space-y-2">
            <p className="text-xs text-muted-foreground">15 high-ICP communities from the June 2026 scrape.</p>
            <div className="flex flex-wrap gap-1.5">
              {SKOOL_PRESETS.map((p) => (
                <a
                  key={p.slug}
                  href={`https://www.skool.com/${p.slug}/about`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs border bg-background hover:bg-accent transition-colors"
                >
                  {p.name}
                  <ExternalLink className="h-3 w-3 text-muted-foreground" />
                </a>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={loadAllPresets}>
              Load all 15 into search box
            </Button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {results !== null && (
        <div className="space-y-2">
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No Instagram profiles found.{" "}
              {activePlatform === "Skool"
                ? "Make sure the slugs are correct — check the URL at skool.com/[slug]/about."
                : "Check that the Whop URLs are valid seller pages."}
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {results.filter((r) => r.source === "page").length} found directly from page ·{" "}
                {results.filter((r) => r.source === "serper").length} via Google search
              </p>
              <div className="rounded-md border divide-y">
                {results.map((r) => {
                  const isAdded = existingSet.has(r.username) || added.has(r.username);
                  return (
                    <div key={`${r.communityName}-${r.username}`} className="flex items-start gap-3 p-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">@{r.username}</span>
                          <a
                            href={`https://www.instagram.com/${r.username}/`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                          <span className="text-xs text-muted-foreground border rounded-full px-2 py-0.5 shrink-0">
                            {r.communityName}
                          </span>
                          <SourceBadge source={r.source} />
                        </div>
                        {r.snippet && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{r.snippet}</p>
                        )}
                        {r.title && r.source === "page" && (
                          <p className="text-xs text-muted-foreground mt-0.5">Owner: {r.title}</p>
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
