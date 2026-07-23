"use client";
import { useMemo, useState, useTransition } from "react";
import { Trash2, Play, AlertCircle, ChevronsRight, Users, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addSeed, deleteSeed, startCrawl, startAllCrawls, checkFollowingCount, type ScrapeProvider } from "@/app/actions/seeds";
import type { Seed } from "@/lib/types";
import { SystemStatus, type SystemStatusProps } from "@/components/ui/system-status";

function friendlyCookieError(msg: string) {
  const l = msg.toLowerCase();
  if (l.includes("rate-limited") || l.includes("rate limited"))
    return "Instagram rate-limited your cookie — wait a few hours or switch to Apify.";
  if (l.includes("rejected") || l.includes("401") || l.includes("403"))
    return "Instagram blocked this burner account — remove it in Settings and add a fresh cookie.";
  return `Last search failed: ${msg}`;
}

const RATE_LIMIT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours — matches cookie-pool.ts

type LatestJob = {
  id: string;
  seed_id: string;
  status: string;
  error_message: string | null;
  finished_at: string | null;
  created_at: string;
};

export function SeedManager({
  seeds,
  exhaustedSeeds = [],
  jobs,
  systemStatus,
  scrapedSeedIds = [],
}: {
  seeds: Seed[];
  exhaustedSeeds?: Seed[];
  jobs: LatestJob[];
  systemStatus: SystemStatusProps;
  /** Seeds with a completed crawl — blocked from scraping again. */
  scrapedSeedIds?: string[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [bulkProvider, setBulkProvider] = useState<ScrapeProvider>("apify");
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  const scraped = useMemo(() => new Set(scrapedSeedIds), [scrapedSeedIds]);

  const latestBySeed = useMemo(() => {
    const m = new Map<string, LatestJob>();
    for (const j of jobs) if (!m.has(j.seed_id)) m.set(j.seed_id, j);
    return m;
  }, [jobs]);

  const onAdd = (formData: FormData) => {
    setError(null);
    setInfo(null);
    start(async () => {
      const res = await addSeed(formData);
      if ("error" in res && res.error) setError(res.error);
      else if ("already_existed" in res && res.already_existed) setInfo("Account was already added — moved to top.");
    });
  };

  return (
    <div className="space-y-4">
      <form action={onAdd} className="flex gap-2">
        <Input
          name="input"
          placeholder="https://www.instagram.com/username/  or  username"
          required
          className="flex-1"
        />
        <Button type="submit" disabled={pending}>Add account</Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {info && <p className="text-sm text-muted-foreground">{info}</p>}

      {seeds.length > 0 && (
        <div className="space-y-2">
          <SystemStatus {...systemStatus} />
        </div>
      )}

      {seeds.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={bulkProvider}
            onChange={(e) => setBulkProvider(e.target.value as ScrapeProvider)}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-sm"
          >
            {PROVIDER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await startAllCrawls(bulkProvider);
                setBulkMsg(`Started ${res.started} crawl${res.started !== 1 ? "s" : ""}.`);
              })
            }
          >
            <ChevronsRight className="h-3.5 w-3.5 mr-1.5" />
            Crawl all
          </Button>
          {bulkMsg && <span className="text-xs text-muted-foreground">{bulkMsg}</span>}
        </div>
      )}

      <div className="rounded-md border divide-y">
        {seeds.length === 0 && <p className="p-4 text-sm text-muted-foreground">No source accounts yet. Add one above to get started.</p>}
        {seeds.map((s) => (
          <SeedRow
            key={s.id}
            seed={s}
            latestJob={latestBySeed.get(s.id) ?? null}
            scraped={scraped.has(s.id)}
          />
        ))}
      </div>

      {exhaustedSeeds.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {exhaustedSeeds.length} seed{exhaustedSeeds.length !== 1 ? "s" : ""} exhausted and hidden from auto-scrape:{" "}
          {exhaustedSeeds.map((s) => `@${s.username}`).join(", ")}
        </p>
      )}
    </div>
  );
}

// ScrapingBee is gone: it has no code path in scrape-following.ts, and
// offering it meant picking a provider that silently ran something else.
const PROVIDER_OPTIONS: { value: ScrapeProvider; label: string }[] = [
  { value: "apify",      label: "Apify (standard)" },
  { value: "auto",       label: "Auto (Apify → Playwright → cookie)" },
  { value: "playwright", label: "Playwright" },
  { value: "cookie",     label: "Cookie only (free, max ~250)" },
];

function SeedRow({
  seed,
  latestJob,
  scraped,
}: {
  seed: Seed;
  latestJob: LatestJob | null;
  /** Has a completed crawl — re-scraping needs the override password. */
  scraped: boolean;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [provider, setProvider] = useState<ScrapeProvider>("apify");
  const [overriding, setOverriding] = useState(false);
  const [password, setPassword] = useState("");
  // Separate transition from the scrape action itself — checking the follower
  // count shouldn't make the "Start search" button read "Starting…".
  const [checking, startCheck] = useTransition();
  const [countError, setCountError] = useState<string | null>(null);

  const rawError =
    latestJob && latestJob.status === "failed" && latestJob.error_message
      ? latestJob.error_message
      : null;
  const errorAge = latestJob?.finished_at ? Date.now() - new Date(latestJob.finished_at).getTime() : 0;
  const isRateLimit = rawError ? rawError.toLowerCase().includes("rate-limited") || rawError.toLowerCase().includes("rate limited") : false;
  const lastError = isRateLimit && errorAge > RATE_LIMIT_TTL_MS ? null : rawError;

  return (
    <div className="flex items-center gap-3 p-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <a href={seed.profile_url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
            @{seed.username}
          </a>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Users className="h-3 w-3 shrink-0" />
            {seed.following_count != null
              ? `${seed.following_count.toLocaleString()} following — that's the scrape size`
              : "following count unknown"}
          </span>
          <button
            type="button"
            disabled={checking}
            onClick={() =>
              startCheck(async () => {
                setCountError(null);
                const res = await checkFollowingCount(seed.id);
                if (!res.ok) setCountError(res.error);
              })
            }
            className="text-muted-foreground hover:text-foreground disabled:opacity-50 shrink-0"
            title={seed.following_count != null ? "Re-check following count" : "Check following count"}
            aria-label="Check following count"
          >
            <RefreshCw className={`h-3 w-3 ${checking ? "animate-spin" : ""}`} />
          </button>
        </div>
        {countError && <p className="text-xs text-destructive">Error checking size: {countError}</p>}
        {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
        {!msg && seed.exhausted_providers.includes("cookie") && (provider === "cookie" || provider === "auto") && (
          <p className="text-xs text-amber-600 flex items-center gap-1">
            <AlertCircle className="h-3 w-3 shrink-0" />
            Cookie exhausted — switch to Apify to get more accounts.
          </p>
        )}
        {lastError && !msg && (
          <p className="text-xs text-destructive flex items-center gap-1 truncate" title={lastError}>
            <AlertCircle className="h-3 w-3 shrink-0" />
            {friendlyCookieError(lastError)}
          </p>
        )}
      </div>

      <select
        value={provider}
        onChange={(e) => setProvider(e.target.value as ScrapeProvider)}
        className="h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-sm"
        aria-label="Scrape method"
      >
        {PROVIDER_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      {scraped && !overriding && (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => setOverriding(true)}
          title="This account has already been scraped"
        >
          Scrape again
        </Button>
      )}
      {/* Keyed off `overriding` alone, not `scraped`: when a crawl finishes
          after this page rendered, `scraped` is still false and gating on it
          would hide the very field the error tells you to fill in. */}
      {overriding && (
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Override password"
          className="w-40 h-8 text-xs"
          autoFocus
          aria-label="Re-scrape override password"
        />
      )}

      <Button
        size="sm"
        variant="secondary"
        // An already-scraped account only becomes startable once the override
        // input is showing — the password is checked server-side regardless.
        disabled={pending || (scraped && !overriding)}
        title={scraped && !overriding ? "Already scraped" : undefined}
        onClick={() =>
          start(async () => {
            const res = await startCrawl(seed.id, provider, overriding ? password : undefined);
            if ("error" in res && res.error) {
              setMsg(`Error: ${res.error}`);
              // The seed finished a crawl after this page rendered, so the row
              // is still showing the un-scraped controls. Reveal the password
              // field instead of asking for a password with nowhere to type it.
              if ("needs_override" in res && res.needs_override) setOverriding(true);
            } else if ("ok" in res && res.ok) {
              setMsg(`Search started — ${provider}, full account.`);
              setOverriding(false);
              setPassword("");
              window.dispatchEvent(new CustomEvent("open-activity-drawer", {
                detail: {
                  label: `Scraping @${res.seed_username}`,
                  // Every crawl is full-account: it runs until the following
                  // list ends, so there's no fixed target to show as a fraction.
                  total: 0,
                  type: "crawl",
                  startedAt: Date.now(),
                  crawl_job_id: res.crawl_job_id,
                },
              }));
            }
          })
        }
      >
        <Play className="h-3 w-3 mr-1" />
        {pending ? "Starting…" : scraped || overriding ? "Scrape again" : "Start search"}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        disabled={pending}
        onClick={() => start(() => deleteSeed(seed.id))}
        aria-label="Remove source account"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
