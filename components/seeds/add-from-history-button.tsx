"use client";
import { useTransition, useState } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addSeed, startCrawl, type ScrapeProvider } from "@/app/actions/seeds";

const PROVIDER_OPTIONS: { value: ScrapeProvider; label: string }[] = [
  { value: "auto",        label: "Auto (best available)" },
  { value: "playwright",  label: "Playwright (unlimited)" },
  { value: "cookie",      label: "Cookie only (free, max ~250)" },
  { value: "apify",       label: "Apify" },
  { value: "scrapingbee", label: "ScrapingBee" },
];

export function ScrapeFromHistoryButton({
  username,
  seedId,
}: {
  username: string;
  seedId?: string;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [provider, setProvider] = useState<ScrapeProvider>("auto");

  const handleScrape = () =>
    start(async () => {
      let id = seedId;

      if (!id) {
        const fd = new FormData();
        fd.append("input", username);
        const res = await addSeed(fd);
        if ("error" in res && res.error) { setMsg(`Error: ${res.error}`); return; }
        const { createClient } = await import("@/lib/supabase/client");
        const sb = createClient();
        const { data } = await sb.from("seeds").select("id").eq("username", username).single();
        if (!data?.id) { setMsg("Could not find seed after adding."); return; }
        id = data.id;
      }

      const res = await startCrawl(id!, provider);
      if ("error" in res && res.error) setMsg(`Error: ${res.error}`);
      else setMsg(`Search started (${provider}).`);
    });

  if (msg) return <span className="text-xs text-muted-foreground">{msg}</span>;

  return (
    <div className="flex items-center gap-2 justify-end">
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
      <Button size="sm" variant="secondary" disabled={pending} onClick={handleScrape}>
        <Play className="h-3 w-3 mr-1.5" />
        {pending ? "Starting…" : "Start search"}
      </Button>
    </div>
  );
}
