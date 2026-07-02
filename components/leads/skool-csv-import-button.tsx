"use client";
import { useEffect, useRef, useState, useTransition, useCallback } from "react";
import { X, FileText, Upload, CheckCircle2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  importSkoolCsv,
  getSkoolImportProgress,
  type SkoolCsvRow,
  type SkoolImportProgress,
} from "@/app/actions/seeds";

// Full RFC4180-ish parser (handles quoted fields with embedded newlines/commas) —
// Skool discovery exports have multi-line descriptions, which a naive
// split-by-line parser silently corrupts.
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some((c) => c.trim())) rows.push(row);
        row = [];
      } else field += ch;
    }
  }
  if (field || row.length) { row.push(field); if (row.some((c) => c.trim())) rows.push(row); }
  return rows;
}

function parseRows(rows: string[][]): SkoolCsvRow[] {
  return rows
    .slice(1) // header
    .map((r) => {
      const urlCol = r.find((c) => /skool\.com\//i.test(c)) ?? "";
      const slugMatch = urlCol.match(/skool\.com\/([^/?]+)/i);
      const memberCol = r.find((c) => /members/i.test(c)) ?? "";
      const memberMatch = memberCol.match(/([\d.]+)(k)?\s*members/i);
      let members: number | null = null;
      if (memberMatch) {
        members = parseFloat(memberMatch[1]);
        if (memberMatch[2]) members *= 1000;
      }
      const priceCol = r.find((c) => /^(free|\$)/i.test(c.trim())) ?? null;
      // Name is usually the shortest non-URL, non-member, non-price column.
      const nameCol = r.find((c) => c !== urlCol && c !== memberCol && c !== priceCol && c.trim().length > 0 && c.trim().length < 80) ?? "";
      return {
        slug: slugMatch ? slugMatch[1] : "",
        name: nameCol.trim() || (slugMatch ? slugMatch[1] : "unknown"),
        members,
        price: priceCol ? priceCol.trim() : null,
      };
    })
    .filter((r) => r.slug);
}

function ImportProgress({ crawlJobId }: { crawlJobId: string }) {
  const [progress, setProgress] = useState<SkoolImportProgress | null>(null);

  const poll = useCallback(async () => {
    const p = await getSkoolImportProgress(crawlJobId);
    setProgress(p);
  }, [crawlJobId]);

  useEffect(() => {
    poll();
    const id = setInterval(async () => {
      const p = await getSkoolImportProgress(crawlJobId);
      setProgress(p);
      if (p?.done) clearInterval(id);
    }, 3000);
    return () => clearInterval(id);
  }, [crawlJobId, poll]);

  if (!progress) return null;
  const pct = progress.total > 0 ? Math.min(100, Math.round((progress.scraped / progress.total) * 100)) : 0;

  return (
    <div className="text-center py-6 space-y-4">
      {progress.done ? <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" /> : (
        <span className="relative h-3 w-3 mx-auto flex">
          <span className="absolute inset-0 rounded-full bg-blue-500 animate-ping opacity-60" />
          <span className="relative h-3 w-3 rounded-full bg-blue-500 block mx-auto" />
        </span>
      )}
      <p className="font-medium">{progress.done ? "Import complete" : "Importing…"}</p>
      <div className="max-w-sm mx-auto space-y-1.5">
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-700 ${progress.done ? "bg-green-500" : "bg-blue-500"}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">
          {progress.scraped} / {progress.total} processed · {progress.qualified} qualified · {progress.rejected} rejected
        </p>
      </div>
    </div>
  );
}

type Step = "upload" | "configure" | "progress";

export function SkoolCsvImportButton({
  open: controlledOpen,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (v: boolean) => { setInternalOpen(v); onOpenChange?.(v); };
  const [step, setStep] = useState<Step>("upload");
  const [rows, setRows] = useState<SkoolCsvRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(50);
  const [paidOnly, setPaidOnly] = useState(true);
  const [crawlJobId, setCrawlJobId] = useState<string | null>(null);
  const [importing, startImport] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const reset = () => {
    setStep("upload");
    setRows(null);
    setError(null);
    setCrawlJobId(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const close = () => { setOpen(false); setTimeout(reset, 300); };

  const handleFile = (file: File) => {
    if (!file.name.endsWith(".csv")) { setError("Must be a .csv file."); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseRows(parseCSV(text));
      if (parsed.length === 0) { setError("No valid rows found — expected a Skool community export with a skool.com URL column."); return; }
      setError(null);
      setRows(parsed);
      setStep("configure");
    };
    reader.readAsText(file);
  };

  const paidCount = rows?.filter((r) => r.price && r.price.toLowerCase() !== "free").length ?? 0;
  const freeCount = (rows?.length ?? 0) - paidCount;

  const selected = rows
    ? [...rows]
        .filter((r) => !paidOnly || (r.price && r.price.toLowerCase() !== "free"))
        .sort((a, b) => (b.members ?? 0) - (a.members ?? 0))
        .slice(0, count)
    : [];

  const handleImport = () => {
    startImport(async () => {
      const res = await importSkoolCsv(selected);
      if (!res.ok || !res.crawl_job_id) { setError(res.error ?? "Import failed"); return; }
      setCrawlJobId(res.crawl_job_id);
      setStep("progress");
    });
  };

  return (
    <>
      {controlledOpen === undefined && (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <Download className="h-4 w-4 mr-2" />
          Import Skool CSV
        </Button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={close} />

          <div className="relative z-10 bg-background rounded-xl shadow-2xl w-full max-w-xl mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
              <div>
                <h2 className="text-lg font-semibold">Import leads from a Skool CSV</h2>
                <p className="text-sm text-muted-foreground">
                  {step === "upload" && "Upload a Skool community discovery export"}
                  {step === "configure" && `${rows?.length ?? 0} communities found — choose which to import`}
                  {step === "progress" && "Scraping Skool pages, finding Instagram accounts, and scoring"}
                </p>
              </div>
              <button onClick={close} className="text-muted-foreground hover:text-foreground p-1 rounded">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-5">
              {step === "upload" && (
                <div
                  className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer
                    ${dragOver ? "border-primary bg-primary/5" : "border-input hover:border-primary/50"}`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const file = e.dataTransfer.files[0];
                    if (file) handleFile(file);
                  }}
                >
                  <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                  <p className="font-medium text-sm mb-1">Drop a Skool export CSV here, or click to browse</p>
                  <p className="text-xs text-muted-foreground">Needs a column with skool.com URLs — member count and price columns are used automatically if present.</p>
                  <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                </div>
              )}

              {step === "configure" && rows && (
                <div className="space-y-4">
                  <p className="text-sm">
                    Found <strong>{rows.length}</strong> communities — <strong>{paidCount}</strong> paid, <strong>{freeCount}</strong> free.
                  </p>

                  <div className="flex flex-wrap items-end gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs">How many to import (highest member count first)</Label>
                      <Input type="number" min={1} max={rows.length} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} className="w-32" />
                    </div>
                    <label className="flex items-center gap-2 text-sm pb-2">
                      <input type="checkbox" checked={paidOnly} onChange={(e) => setPaidOnly(e.target.checked)} />
                      Paid communities only (stronger monetization signal)
                    </label>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Will process <strong>{selected.length}</strong> communities: scrape each Skool page for the owner&rsquo;s real Instagram, then scrape + score that account and save it as a lead.
                  </p>
                </div>
              )}

              {step === "progress" && crawlJobId && <ImportProgress crawlJobId={crawlJobId} />}

              {error && <p className="text-sm text-destructive mt-3">{error}</p>}
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t shrink-0">
              <Button variant="ghost" size="sm" onClick={step === "upload" ? close : reset}>
                {step === "upload" ? "Cancel" : "← Start over"}
              </Button>
              <div className="flex items-center gap-2">
                {step === "configure" && (
                  <Button onClick={handleImport} disabled={importing || selected.length === 0}>
                    <Upload className="h-4 w-4 mr-1.5" />
                    {importing ? "Starting…" : `Import ${selected.length} communities`}
                  </Button>
                )}
                {step === "progress" && (
                  <Button onClick={close}>
                    <CheckCircle2 className="h-4 w-4 mr-1" /> Done
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
