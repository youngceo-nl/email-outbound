import { createClient } from "@supabase/supabase-js";
import { buildProductionIdentityUpdate } from "./configure-production-identities-lib";
import type { AppSettings } from "../lib/types";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data, error } = await sb.from("app_settings").select("*").eq("id", 1).single();
  if (error || !data) throw new Error(error?.message ?? "settings row missing");
  const settings = data as AppSettings;
  const update = buildProductionIdentityUpdate(settings, process.env);

  console.log(`mode: ${apply ? "APPLY" : "DRY RUN"}`);
  for (const account of update.instagram_accounts.filter((item) => item.group === "C")) {
    let endpoint = "none";
    if (account.proxy_url) {
      const url = new URL(account.proxy_url);
      endpoint = `${url.hostname}:${url.port}`;
    }
    console.log(
      `${account.label.padEnd(20)} paused=${String(!!account.paused).padEnd(5)} ` +
        `proxy=${endpoint} steel=${account.steel_profile_id ?? "none"}`,
    );
  }
  if (!apply) return;

  const { data: written, error: writeError } = await sb
    .from("app_settings")
    .update(update)
    .eq("id", 1)
    .eq("updated_at", settings.updated_at)
    .select("id")
    .maybeSingle();
  if (writeError) throw new Error(writeError.message);
  if (!written) throw new Error("Settings changed during configuration. Re-run the dry run.");
  console.log("Production identities updated atomically.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
