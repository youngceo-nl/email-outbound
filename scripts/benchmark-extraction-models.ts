/*
 * Extraction-model benchmark — OpenRouter vs the production extractor.
 *
 * Runs lib/qualification/extract.ts's real extraction step (unmodified)
 * against a set of already-captured evidence snapshots, once per candidate
 * OpenRouter model, and diffs the result against the production Haiku 4.5
 * baseline already stored for those same leads. Vision and the challenger
 * are intentionally not exercised — decideCommercialQualification is called
 * with visualIdentity/challenger both null, purely to surface `track` and
 * `qualification`/`icp_scores.total_icp_score` for comparison.
 *
 * Input is a --replay-style bundle (the JSON array scripts/qualify-profiles.ts
 * writes via --out), not a live scrape — every model runs against identical
 * evidence, so any difference in the output is the model, not the input.
 *
 * Usage:
 *   npx tsx --env-file-if-exists=.env.local scripts/benchmark-extraction-models.ts
 *   npx tsx --env-file-if-exists=.env.local scripts/benchmark-extraction-models.ts --models openai/gpt-4.1-nano
 *   npx tsx --env-file-if-exists=.env.local scripts/benchmark-extraction-models.ts --leads /tmp/batch-40-results.json --usernames adelman.aspires,shauneng
 */

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { createLlmClient } from "@/lib/qualification/providers";
import { extractCommercialEvidence } from "@/lib/qualification/extract";
import { decideCommercialQualification } from "@/lib/qualification/decide";
import type { CommercialExtraction, EvidenceSnapshot } from "@/lib/qualification/types";

const DEFAULT_LEADS_BUNDLE = "/tmp/batch-40-results.json";
const DEFAULT_USERNAMES = [
  "adelman.aspires",
  "heatherblankenshipx3",
  "shauneng",
  "x_gainz",
  "ecomtimm",
];
const DEFAULT_MODELS = [
  "google/gemini-2.5-flash",
  "deepseek/deepseek-chat",
  "openai/gpt-4.1-nano",
  "meta-llama/llama-3.3-70b-instruct",
  "qwen/qwen-2.5-72b-instruct",
];

const COMPARE_FIELDS = [
  "information_funnel.state",
  "transformation.state",
  "human_personal_brand.state",
  "coach_or_consultant.state",
] as const;

type BundleEntry = {
  input: string;
  result: {
    snapshot: EvidenceSnapshot | null;
    extraction: { ok: boolean; extraction: CommercialExtraction | null } | null;
  } | null;
};

type ModelPricing = { promptUsdPerTok: number; completionUsdPerTok: number };

type LeadResult = {
  username: string;
  ok: boolean;
  error?: string;
  repaired?: boolean;
  citationWarnings?: number;
  mismatches?: string[];
  track?: string;
  qualification?: string;
  totalIcpScore?: number | null;
  baselineTrack?: string;
  baselineQualification?: string;
  baselineTotalIcpScore?: number | null;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number | null;
  latencyMs?: number;
};

function parseArgs(argv: string[]) {
  let leads = DEFAULT_LEADS_BUNDLE;
  let usernames = DEFAULT_USERNAMES;
  let models = DEFAULT_MODELS;
  let out: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--leads") leads = argv[++i];
    else if (arg === "--usernames") usernames = argv[++i].split(",").map((s) => s.trim());
    else if (arg === "--models") models = argv[++i].split(",").map((s) => s.trim());
    else if (arg === "--out") out = argv[++i];
  }
  return { leads, usernames, models, out };
}

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

async function fetchOpenRouterPricing(): Promise<Map<string, ModelPricing>> {
  const res = await fetch("https://openrouter.ai/api/v1/models");
  if (!res.ok) throw new Error(`OpenRouter models list failed: ${res.status}`);
  const json = (await res.json()) as {
    data: Array<{ id: string; pricing?: { prompt?: string; completion?: string } }>;
  };
  const map = new Map<string, ModelPricing>();
  for (const m of json.data) {
    if (!m.pricing?.prompt || !m.pricing?.completion) continue;
    map.set(m.id, {
      promptUsdPerTok: Number(m.pricing.prompt),
      completionUsdPerTok: Number(m.pricing.completion),
    });
  }
  return map;
}

function loadAnchorLeads(bundlePath: string, usernames: string[]) {
  const raw = readFileSync(bundlePath, "utf8");
  const entries = JSON.parse(raw) as BundleEntry[];
  const wanted = new Set(usernames);
  const found: {
    username: string;
    snapshot: EvidenceSnapshot;
    baseline: CommercialExtraction;
  }[] = [];

  for (const entry of entries) {
    if (!wanted.has(entry.input)) continue;
    const snapshot = entry.result?.snapshot ?? null;
    const baseline = entry.result?.extraction?.extraction ?? null;
    if (!snapshot || !baseline) {
      console.warn(`  skipping ${entry.input}: no stored snapshot/extraction in bundle`);
      continue;
    }
    found.push({ username: entry.input, snapshot, baseline });
  }
  return found;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("Missing OPENROUTER_API_KEY. Set it in .env.local and run with --env-file-if-exists=.env.local");
    process.exit(1);
  }

  console.log(`Loading anchor leads from ${args.leads} ...`);
  const leads = loadAnchorLeads(args.leads, args.usernames);
  console.log(`  ${leads.length}/${args.usernames.length} leads found with stored snapshot + baseline extraction`);
  if (leads.length === 0) {
    console.error("No usable leads — nothing to benchmark.");
    process.exit(1);
  }

  console.log("Fetching OpenRouter model pricing ...");
  const pricing = await fetchOpenRouterPricing();

  const allResults: Record<string, LeadResult[]> = {};

  for (const model of args.models) {
    console.log(`\n=== ${model} ===`);
    const llm = createLlmClient({ provider: "openrouter", model, apiKey });
    const price = pricing.get(model);
    if (!price) console.warn(`  no published pricing found for ${model} — cost will be null`);

    const leadResults: LeadResult[] = [];
    for (const lead of leads) {
      const t0 = Date.now();
      let extractionResult;
      try {
        extractionResult = await extractCommercialEvidence({ snapshot: lead.snapshot, llm });
      } catch (err) {
        leadResults.push({
          username: lead.username,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
        console.log(`  ${lead.username}: ERROR — ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      const latencyMs = Date.now() - t0;

      if (!extractionResult.ok) {
        leadResults.push({
          username: lead.username,
          ok: false,
          error: `${extractionResult.reason}: ${extractionResult.problems.join("; ")}`,
          inputTokens: extractionResult.usage.inputTokens,
          outputTokens: extractionResult.usage.outputTokens,
          latencyMs,
        });
        console.log(`  ${lead.username}: FAILED (${extractionResult.reason})`);
        continue;
      }

      const decision = decideCommercialQualification({
        snapshot: lead.snapshot,
        extraction: extractionResult.extraction,
        visualIdentity: null,
        challenger: null,
        challengerAgrees: null,
        citationWarnings: extractionResult.citation_warnings,
      });
      const baselineDecision = decideCommercialQualification({
        snapshot: lead.snapshot,
        extraction: lead.baseline,
        visualIdentity: null,
        challenger: null,
        challengerAgrees: null,
      });

      const mismatches = COMPARE_FIELDS.filter((field) => {
        const a = getPath(extractionResult.extraction, field);
        const b = getPath(lead.baseline, field);
        return a !== b;
      }).map((field) => {
        const a = getPath(extractionResult.extraction, field);
        const b = getPath(lead.baseline, field);
        return `${field}: got "${a}", baseline "${b}"`;
      });

      const usd = price
        ? extractionResult.usage.inputTokens * price.promptUsdPerTok +
          extractionResult.usage.outputTokens * price.completionUsdPerTok
        : null;

      leadResults.push({
        username: lead.username,
        ok: true,
        repaired: extractionResult.repaired,
        citationWarnings: extractionResult.citation_warnings.length,
        mismatches,
        track: decision.track,
        qualification: decision.qualification,
        totalIcpScore: decision.icp_scores?.total_icp_score ?? null,
        baselineTrack: baselineDecision.track,
        baselineQualification: baselineDecision.qualification,
        baselineTotalIcpScore: baselineDecision.icp_scores?.total_icp_score ?? null,
        inputTokens: extractionResult.usage.inputTokens,
        outputTokens: extractionResult.usage.outputTokens,
        costUsd: usd,
        latencyMs,
      });
      console.log(
        `  ${lead.username}: qualification=${decision.qualification} (baseline ${baselineDecision.qualification}) ` +
          `score=${decision.icp_scores?.total_icp_score ?? "?"} (baseline ${baselineDecision.icp_scores?.total_icp_score ?? "?"}) ` +
          `mismatches=${mismatches.length} repaired=${extractionResult.repaired} cost=${usd !== null ? `$${usd.toFixed(5)}` : "?"} ${latencyMs}ms`,
      );
    }
    allResults[model] = leadResults;
  }

  printSummary(allResults);
  appendMarkdownReport(allResults);

  if (args.out) {
    writeFileSync(args.out, JSON.stringify(allResults, null, 2));
    console.log(`\nFull results written to ${args.out}`);
  }
}

function printSummary(allResults: Record<string, LeadResult[]>) {
  console.log("\n\n=== Summary ===");
  console.log(
    "model".padEnd(36) +
      "ok".padEnd(6) +
      "repaired".padEnd(10) +
      "mismatches".padEnd(12) +
      "avg cost/lead".padEnd(16) +
      "avg latency",
  );
  for (const [model, results] of Object.entries(allResults)) {
    const ok = results.filter((r) => r.ok);
    const repaired = ok.filter((r) => r.repaired).length;
    const totalMismatches = ok.reduce((sum, r) => sum + (r.mismatches?.length ?? 0), 0);
    const costs = ok.map((r) => r.costUsd).filter((c): c is number => c !== null && c !== undefined);
    const avgCost = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : null;
    const latencies = ok.map((r) => r.latencyMs).filter((l): l is number => l !== undefined);
    const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;
    console.log(
      model.padEnd(36) +
        `${ok.length}/${results.length}`.padEnd(6) +
        `${repaired}`.padEnd(10) +
        `${totalMismatches}`.padEnd(12) +
        (avgCost !== null ? `$${avgCost.toFixed(5)}`.padEnd(16) : "?".padEnd(16)) +
        (avgLatency !== null ? `${Math.round(avgLatency)}ms` : "?"),
    );
  }
}

function appendMarkdownReport(allResults: Record<string, LeadResult[]>) {
  const lines: string[] = [];
  lines.push(`\n## Benchmark results — ${new Date().toISOString().slice(0, 10)}\n`);
  lines.push(
    "| Model | OK | Repaired | Mismatches vs Haiku | Avg cost/lead | Avg latency |",
  );
  lines.push("|---|---|---|---|---|---|");
  for (const [model, results] of Object.entries(allResults)) {
    const ok = results.filter((r) => r.ok);
    const repaired = ok.filter((r) => r.repaired).length;
    const totalMismatches = ok.reduce((sum, r) => sum + (r.mismatches?.length ?? 0), 0);
    const costs = ok.map((r) => r.costUsd).filter((c): c is number => c !== null && c !== undefined);
    const avgCost = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : null;
    const latencies = ok.map((r) => r.latencyMs).filter((l): l is number => l !== undefined);
    const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;
    lines.push(
      `| ${model} | ${ok.length}/${results.length} | ${repaired} | ${totalMismatches} | ${
        avgCost !== null ? `$${avgCost.toFixed(5)}` : "?"
      } | ${avgLatency !== null ? `${Math.round(avgLatency)}ms` : "?"} |`,
    );
  }

  lines.push("\n### Per-lead detail\n");
  for (const [model, results] of Object.entries(allResults)) {
    lines.push(`**${model}**\n`);
    for (const r of results) {
      if (!r.ok) {
        lines.push(`- \`${r.username}\`: ERROR — ${r.error}`);
        continue;
      }
      const scoreLine = `qualification=${r.qualification} (baseline ${r.baselineQualification}), score=${r.totalIcpScore} (baseline ${r.baselineTotalIcpScore})`;
      lines.push(`- \`${r.username}\`: ${scoreLine}`);
      for (const m of r.mismatches ?? []) lines.push(`  - ${m}`);
    }
    lines.push("");
  }

  const docPath = "docs/testruns/ai-optimization.md";
  appendFileSync(docPath, lines.join("\n"));
  console.log(`\nAppended results to ${docPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
