/*
 * Qualification CLI.
 *
 * Runs the full commercial qualification pipeline against Instagram profile
 * URLs or usernames and prints a reviewable report. Writes nothing to the
 * database unless --persist is passed — by default this stays the harness
 * for judging decision quality before the pipeline is wired into production
 * routing (Task 10).
 *
 * Usage:
 *   npx tsx scripts/qualify-profiles.ts <url-or-username> [...]
 *   npx tsx scripts/qualify-profiles.ts --file profiles.txt
 *
 * Options:
 *   --provider openai|anthropic   (default: anthropic when ANTHROPIC_API_KEY is set)
 *   --model <id>
 *   --out <path>                  write the full JSON result bundle
 *   --concurrency <n>             default 3
 *   --persist                     write snapshot/extraction/decision rows via
 *                                  lib/qualification/repository.ts, and update
 *                                  the lead's projection columns when the
 *                                  username matches an existing lead row
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  acquireInstagramEvidence,
  normalizeInstagramEvidence,
  usernameFromInstagramUrl,
} from "@/lib/evidence/instagram";
import { createPageFetcher, DEFAULT_EXTERNAL_CONFIG } from "@/lib/evidence/external";
import {
  requalifyFromSnapshot,
  runCommercialQualification,
  type QualificationRunResult,
} from "@/lib/qualification/run";
import type { EvidenceSnapshot } from "@/lib/qualification/types";
import { createLlmClient, type LlmProvider } from "@/lib/qualification/providers";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createDecision,
  createEvidenceSnapshot,
  createExtraction,
  setLeadQualificationProjection,
} from "@/lib/qualification/repository";
import { PIPELINE_VERSION } from "@/lib/evidence/versions";

type Args = {
  inputs: string[];
  provider: LlmProvider;
  model: string;
  challengerModel: string;
  out: string | null;
  /** Re-run extraction and decisioning against stored snapshots, no acquisition. */
  replay: string | null;
  concurrency: number;
  persist: boolean;
};

function parseArgs(argv: string[]): Args {
  const inputs: string[] = [];
  let provider: LlmProvider | null = null;
  let model: string | null = null;
  let challengerModel: string | null = null;
  let out: string | null = null;
  let replay: string | null = null;
  let concurrency = 2;
  let persist = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--provider") provider = argv[++i] as LlmProvider;
    else if (arg === "--model") model = argv[++i];
    else if (arg === "--challenger-model") challengerModel = argv[++i];
    else if (arg === "--out") out = argv[++i];
    else if (arg === "--replay") replay = argv[++i];
    else if (arg === "--concurrency") concurrency = Number(argv[++i]) || 3;
    else if (arg === "--persist") persist = true;
    else if (arg === "--file") {
      const contents = readFileSync(argv[++i], "utf8");
      inputs.push(...contents.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    } else if (!arg.startsWith("--")) inputs.push(arg);
  }

  const resolvedProvider =
    provider ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "openai");
  const resolvedModel =
    model ??
    (resolvedProvider === "anthropic"
      ? (process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5")
      : (process.env.OPENAI_MODEL ?? "gpt-4o"));

  return {
    inputs,
    provider: resolvedProvider,
    model: resolvedModel,
    // The challenger only runs on high-impact decisions, so it can afford to be
    // a stronger model than the per-lead extractor.
    challengerModel:
      challengerModel ??
      (resolvedProvider === "anthropic" ? "claude-opus-5" : resolvedModel),
    out,
    replay,
    concurrency,
    persist,
  };
}

/** Env-only mirror of lib/config/settings.ts's resolveApifyTokens — the CLI has no DB settings row. */
function resolveApifyTokensFromEnv(): string[] | null {
  const tokens = (process.env.APIFY_TOKENS ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const single = process.env.APIFY_TOKEN?.trim();
  if (single && !tokens.includes(single)) tokens.push(single);
  return tokens.length > 0 ? tokens : null;
}

/**
 * Writes one run's snapshot/extraction/decision through lib/qualification/repository.ts.
 * Each call inserts new rows — never updates a prior run's rows — so replaying
 * the same profile twice produces two full, independently queryable snapshots.
 * When the username matches an existing `leads` row, that lead's projection
 * columns are updated to point at the new decision.
 */
async function persistResult(username: string, result: QualificationRunResult): Promise<string> {
  const supabase = createAdminClient();

  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .select("id")
    .eq("username", username.toLowerCase())
    .maybeSingle();
  if (leadErr) throw new Error(`lead lookup failed: ${leadErr.message}`);
  const leadId = (lead?.id as string | undefined) ?? null;

  if (!result.snapshot) return "no evidence snapshot to persist";

  const { id: snapshotId } = await createEvidenceSnapshot({
    snapshot: result.snapshot,
    leadId,
    supabase,
  });

  let extractionId: string | null = null;
  if (result.extraction) {
    const created = await createExtraction({
      evidenceSnapshotId: snapshotId,
      leadId,
      extraction: result.extraction,
      supabase,
    });
    extractionId = created.id;
  }

  const { id: decisionId } = await createDecision({
    evidenceSnapshotId: snapshotId,
    extractionId,
    leadId,
    decision: result.decision,
    supabase,
  });

  if (leadId) {
    await setLeadQualificationProjection({
      leadId,
      projection: {
        qualification_state: "done",
        qualification_outcome: result.decision.decision,
        qualification_decision_id: decisionId,
        qualification_ready_at: new Date().toISOString(),
        qualification_review_reason: result.decision.review_flags[0] ?? null,
        qualification_pipeline_version: PIPELINE_VERSION,
        approval_source: result.decision.mode === "auto_approved" ? "automatic" : null,
      },
      supabase,
    });
  }

  return `snapshot=${snapshotId} decision=${decisionId}${leadId ? ` lead=${leadId}` : " (no matching lead row)"}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.inputs.length === 0 && !args.replay) {
    console.error("usage: npx tsx scripts/qualify-profiles.ts <instagram-url-or-username> [...]");
    process.exit(1);
  }

  const scrapingBeeKey = process.env.SCRAPINGBEE_API_KEY ?? null;
  if (!scrapingBeeKey && !args.replay) {
    console.error("SCRAPINGBEE_API_KEY is required to acquire Instagram profile evidence.");
    process.exit(1);
  }

  const apiKey =
    args.provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error(`Missing API key for provider "${args.provider}".`);
    process.exit(1);
  }

  const llm = createLlmClient({ provider: args.provider, model: args.model, apiKey });
  const challengerLlm = createLlmClient({
    provider: args.provider,
    model: args.challengerModel,
    apiKey,
  });
  if (args.replay) {
    await runReplay(args, llm, challengerLlm);
    return;
  }

  const externalConfig = { ...DEFAULT_EXTERNAL_CONFIG, scrapingBeeApiKey: scrapingBeeKey };

  const fetchPage = createPageFetcher(externalConfig);

  const usernames = args.inputs.map((input) => ({
    input,
    username: usernameFromInstagramUrl(input),
  }));

  console.log(
    `\nQualifying ${usernames.length} profile(s)\n` +
      `  extractor:  ${args.provider}/${args.model}\n` +
      `  challenger: ${args.provider}/${args.challengerModel}\n` +
      `${"=".repeat(78)}`,
  );

  const results: Array<{ input: string; result: QualificationRunResult | null; error: string | null }> = [];

  // Bounded concurrency: the acquisition layer makes several network calls per
  // profile and Instagram rate-limits aggressively when hit in parallel.
  const queue = [...usernames];
  const workers = Array.from({ length: Math.min(args.concurrency, queue.length) }, async () => {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      if (!item.username) {
        results.push({ input: item.input, result: null, error: "could not parse an Instagram username" });
        continue;
      }
      try {
        const raw = await acquireInstagramEvidence({
          apiKey: scrapingBeeKey as string,
          username: item.username,
          sessionCookie: process.env.INSTAGRAM_SESSION_COOKIE ?? null,
          apifyToken: resolveApifyTokensFromEnv(),
        });
        const instagram = normalizeInstagramEvidence(raw);
        const result = await runCommercialQualification({
          instagram,
          llm,
          external: externalConfig,
          youtube: { apiKey: process.env.YOUTUBE_API_KEY ?? null },
          dependencies: { fetchPage, llm, challengerLlm },
        });
        results.push({ input: item.input, result, error: null });
        process.stderr.write(`  done: @${item.username} -> ${result.decision.decision}/${result.decision.mode}\n`);
        if (args.persist) {
          try {
            const persisted = await persistResult(item.username, result);
            process.stderr.write(`  persisted: @${item.username} -> ${persisted}\n`);
          } catch (err) {
            process.stderr.write(`  PERSIST FAILED: @${item.username}: ${err}\n`);
          }
        }
      } catch (err) {
        results.push({
          input: item.input,
          result: null,
          error: err instanceof Error ? err.message : String(err),
        });
        process.stderr.write(`  FAILED: @${item.username}: ${err}\n`);
      }
    }
  });
  await Promise.all(workers);

  const ordered = usernames.map(
    ({ input }) => results.find((entry) => entry.input === input) ?? { input, result: null, error: "no result" },
  );

  for (const entry of ordered) printReport(entry);
  printSummary(ordered);

  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify(ordered, null, 2));
    console.log(`\nFull evidence bundle written to ${args.out}`);
  }
}

/*
 * Replay mode. Loads stored snapshots and re-runs extraction + decisioning only.
 * Costs no acquisition credits and is deterministic with respect to the evidence,
 * which is what makes prompt and scorecard comparisons meaningful.
 */
async function runReplay(
  args: Args,
  llm: ReturnType<typeof createLlmClient>,
  challengerLlm: ReturnType<typeof createLlmClient>,
): Promise<void> {
  const bundle = JSON.parse(readFileSync(args.replay as string, "utf8")) as Array<{
    input: string;
    result: { snapshot: EvidenceSnapshot | null } | null;
  }>;

  const withSnapshots = bundle.filter((entry) => entry.result?.snapshot);
  console.log(
    `\nReplaying ${withSnapshots.length} stored snapshot(s) from ${args.replay}\n` +
      `  extractor:  ${args.provider}/${args.model}\n` +
      `  challenger: ${args.provider}/${args.challengerModel}\n` +
      `  (no acquisition — snapshots are replayed exactly as captured)\n` +
      `${"=".repeat(78)}`,
  );

  const results: Array<{ input: string; result: QualificationRunResult | null; error: string | null }> = [];
  for (const entry of bundle) {
    const snapshot = entry.result?.snapshot;
    if (!snapshot) {
      results.push({ input: entry.input, result: null, error: "no stored snapshot to replay" });
      continue;
    }
    try {
      const result = await requalifyFromSnapshot({ snapshot, llm, challengerLlm });
      results.push({ input: entry.input, result, error: null });
      process.stderr.write(`  done: @${result.username} -> ${result.decision.decision}/${result.decision.mode}\n`);
    } catch (err) {
      results.push({ input: entry.input, result: null, error: err instanceof Error ? err.message : String(err) });
      process.stderr.write(`  FAILED: ${entry.input}: ${err}\n`);
    }
  }

  for (const entry of results) printReport(entry);
  printSummary(results);

  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify(results, null, 2));
    console.log(`\nFull evidence bundle written to ${args.out}`);
  }
}

function printReport(entry: { input: string; result: QualificationRunResult | null; error: string | null }): void {
  console.log(`\n${"=".repeat(78)}`);
  if (!entry.result) {
    console.log(`${entry.input}\n  ERROR: ${entry.error}`);
    return;
  }

  const { result } = entry;
  const d = result.decision;
  const ig = result.snapshot?.instagram;

  console.log(`@${result.username}  —  ${ig?.display_name ?? "(no display name)"}`);
  console.log(`${"-".repeat(78)}`);
  console.log(`DECISION      ${d.decision.toUpperCase()}  (${d.mode})`);
  console.log(`track         ${d.track}`);
  console.log(`commercial    ${d.scores.commercial_fit} / 10        certainty: ${d.certainty}`);
  console.log(`priority      ${d.priority ? `${d.priority.value} / 10 (${d.priority.data_completeness})` : "n/a"}`);
  console.log(`outcome       ${d.primary_visitor_outcome ?? "unknown"}`);
  if (d.rejection_reason) console.log(`rejected for  ${d.rejection_reason}`);

  console.log(`\nSCORES`);
  console.log(
    `  buyer ${pad(d.scores.buyer_clarity)}  transformation ${pad(d.scores.transformation_clarity)}  ` +
      `funnel ${pad(d.scores.information_funnel_evidence)}  conversion ${pad(d.scores.conversion_intent)}  ` +
      `proof+authority ${pad(d.scores.proof_maturity)} (${pad(d.scores.proof_strength)}+${pad(d.scores.authority_strength)})`,
  );

  console.log(`\nSIGNALS`);
  for (const [name, state] of Object.entries(d.signal_states)) {
    console.log(`  ${name.padEnd(22)} ${state}`);
  }

  if (result.snapshot) {
    const snap = result.snapshot;
    console.log(`\nACQUISITION   stop=${snap.acquisition_stop_reason}  sufficiency=${snap.acquisition_sufficiency}  hops=${snap.hops_used}`);
    console.log(`  bio: ${truncate(ig?.bio ?? "(none)", 150)}`);
    console.log(`  link: ${ig?.external_link ?? "(none)"}`);

    if (snap.external_destinations.length > 0) {
      console.log(`  destinations inspected:`);
      for (const dest of snap.external_destinations) {
        const label = dest.capture_status === "captured"
          ? `${dest.destination_type}`
          : `${dest.capture_status}${dest.error ? ` (${truncate(dest.error, 40)})` : ""}`;
        console.log(`    [hop ${dest.hop}] ${label.padEnd(24)} ${truncate(dest.final_url ?? dest.source_url, 70)}`);
      }
    }
    if (snap.youtube_channels.length > 0 || snap.youtube_videos.length > 0) {
      console.log(`  youtube: ${snap.youtube_channels.length} channel(s), ${snap.youtube_videos.length} video description(s)`);
    }
    if (snap.cta_chain.length > 0) {
      console.log(`  CTA chain: ${snap.cta_chain.map((hop) => hop.action).join(" -> ")}`);
    }
    if (snap.unknown_surfaces.length > 0) {
      console.log(`  unknown surfaces: ${snap.unknown_surfaces.map((s) => `${s.surface}=${s.capture_status}`).join(", ")}`);
    }
  }

  if (result.extraction?.ok) {
    const ex = result.extraction.extraction;
    console.log(`\nEXTRACTED`);
    console.log(`  audience:       ${ex.audience.value ?? "-"} (${ex.audience.label})`);
    console.log(`  transformation: ${ex.transformation.outcome ?? "-"} (${ex.transformation.label})`);
    console.log(`  funnel:         ${ex.information_funnel.asset_or_offer ?? "-"} (${ex.information_funnel.label})`);
    console.log(`  cta:            ${ex.cta.action ?? "-"} (${ex.cta.label})`);
    console.log(`  models:         ${ex.business_models.map((m) => `${m.type}:${m.prominence}`).join(", ") || "-"}`);
    if (ex.offers.length > 0) {
      console.log(`  offers:`);
      for (const offer of ex.offers) {
        console.log(`    - ${offer.name ?? offer.offer_id} [${offer.type}/${offer.prominence}] -> ${offer.visitor_receives.join(",") || "?"}`);
      }
    }
    const proofs = [...new Map([...ex.proof.claims, ...ex.proof_attribution].map((p) => [p.proof_id, p])).values()];
    if (proofs.length > 0) {
      console.log(`  proof:`);
      for (const proof of proofs) console.log(`    - ${truncate(proof.claim, 60)} [${proof.beneficiary}]`);
    }
    if (ex.agency_evidence_bundle.reliability !== "absent") {
      console.log(`  agency evidence: ${ex.agency_evidence_bundle.reliability}`);
    }
    if (ex.conflicts.length > 0) console.log(`  conflicts: ${ex.conflicts.join("; ")}`);
    if (result.extraction.citation_warnings.length > 0) {
      console.log(`  citation warnings: ${result.extraction.citation_warnings.length}`);
    }
  } else if (result.extraction) {
    console.log(`\nEXTRACTION FAILED (${result.extraction.reason})`);
    for (const problem of result.extraction.problems.slice(0, 6)) console.log(`  - ${problem}`);
  }

  console.log(`\nCHALLENGER    ${result.challenger_trigger}`);
  if (result.challenger?.result) {
    console.log(`  conclusion: ${result.challenger.result.business_model_conclusion}  agrees=${result.challenger.agrees}`);
    console.log(`  reason: ${truncate(result.challenger.result.reason, 140)}`);
    for (const disagreement of result.challenger.disagreements) console.log(`  ! ${disagreement}`);
  } else if (result.challenger?.error) {
    console.log(`  error: ${truncate(result.challenger.error, 140)}`);
  }

  console.log(`\nREASONS       ${d.decision_reasons.join(", ") || "-"}`);
  console.log(`FLAGS         ${d.review_flags.join(", ") || "-"}`);
  console.log(
    `TIMING        ${result.timings_ms.total}ms total ` +
      `(acq ${result.timings_ms.acquisition} / extract ${result.timings_ms.extraction} / challenge ${result.timings_ms.challenger})  ` +
      `tokens ${result.usage.inputTokens}in ${result.usage.outputTokens}out`,
  );
}

function printSummary(
  entries: Array<{ input: string; result: QualificationRunResult | null; error: string | null }>,
): void {
  console.log(`\n${"=".repeat(78)}\nSUMMARY\n${"=".repeat(78)}`);
  console.log(
    `${"profile".padEnd(24)} ${"decision".padEnd(11)} ${"mode".padEnd(15)} ${"track".padEnd(28)} ${"fit".padEnd(6)} certainty`,
  );
  for (const entry of entries) {
    if (!entry.result) {
      console.log(`${truncate(entry.input, 23).padEnd(24)} ERROR       ${truncate(entry.error ?? "", 40)}`);
      continue;
    }
    const d = entry.result.decision;
    console.log(
      `${`@${entry.result.username}`.padEnd(24)} ${d.decision.padEnd(11)} ${d.mode.padEnd(15)} ` +
        `${d.track.padEnd(28)} ${String(d.scores.commercial_fit).padEnd(6)} ${d.certainty}`,
    );
  }
}

function pad(value: number): string {
  return value.toFixed(2).replace(/\.00$/, "").padStart(4);
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
