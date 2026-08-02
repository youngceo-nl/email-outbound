import { createAdminClient } from "@/lib/supabase/admin";
const sb = createAdminClient();

const { data } = await sb
  .from("lead_commercial_extractions")
  .select("ok, model, provider, input_tokens, output_tokens, created_at, payload")
  .order("created_at", { ascending: true })
  .limit(2000);

console.log("total extraction rows:", data?.length);

// Walk chronologically, find transition points
let firstFail: string | null = null;
let lastOk: string | null = null;
let okCount = 0, failCount = 0;
let okIn = 0, okOut = 0;
const byModel: Record<string, {ok:number, fail:number, in:number, out:number}> = {};

for (const e of data ?? []) {
  const m = e.model ?? "(null)";
  byModel[m] ??= {ok:0, fail:0, in:0, out:0};
  if (e.ok) {
    okCount++; lastOk = e.created_at;
    okIn += e.input_tokens ?? 0; okOut += e.output_tokens ?? 0;
    byModel[m].ok++; byModel[m].in += e.input_tokens ?? 0; byModel[m].out += e.output_tokens ?? 0;
  } else {
    failCount++;
    if (!firstFail) firstFail = e.created_at;
    byModel[m].fail++;
  }
}
console.log("\nfirst FAILURE at :", firstFail);
console.log("last SUCCESS at  :", lastOk);
console.log(`ok=${okCount} fail=${failCount}`);
console.log(`\nsuccessful extraction tokens: ${okIn} in / ${okOut} out`);

console.log("\nby model:");
for (const [m, v] of Object.entries(byModel)) {
  console.log(`  ${m.padEnd(22)} ok=${String(v.ok).padStart(4)} fail=${String(v.fail).padStart(4)}  tokens ${v.in}in/${v.out}out`);
}

// chronological run of first 60 rows
console.log("\nfirst 60 rows chronologically (S=ok, x=fail):");
console.log((data ?? []).slice(0,60).map(e => e.ok ? "S" : "x").join(""));
console.log("\nlast 60 rows:");
console.log((data ?? []).slice(-60).map(e => e.ok ? "S" : "x").join(""));
