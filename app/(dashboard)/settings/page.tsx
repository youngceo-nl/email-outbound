import { getSettings } from "@/lib/config/settings";
import { SettingsForm } from "@/components/settings/settings-form";
import type { ManagedAccount, ManagedAccountDisplay } from "@/lib/types";
import { CheckCircle2, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

function stripAccount(a: ManagedAccount): ManagedAccountDisplay {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { id: a.id, label: a.label, account_email: a.account_email ?? null, password: a.password, totp_secret: a.totp_secret, cookie: a.cookie, cookie_set_at: a.cookie_set_at, last_error: a.last_error, checkpoint_state: (a.checkpoint_state ?? null) as any, proxy_url: a.proxy_url ?? null, group: a.group ?? null, paused: a.paused ?? false };
}

// The OAuth callback (app/api/google/oauth/callback) redirects back here with
// one of these — a plain query param since the callback is a server route
// with no client state to hand back through.
const GMAIL_MESSAGES: Record<string, string> = {
  connected: "Gmail connected.",
  denied: "Gmail connection was denied.",
  missing_client: "Save a Gmail Client ID and Secret first, then Connect Gmail.",
  bad_state: "Gmail connection expired — try Connect Gmail again.",
  no_code: "Gmail connection didn't return an authorization code — try again.",
  error: "Gmail connection failed.",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ gmail?: string; detail?: string }>;
}) {
  const settings = await getSettings(true);
  const sp = await searchParams;

  const igAccounts: ManagedAccountDisplay[] = (settings.instagram_accounts ?? []).map(stripAccount);

  const gmailStatus = sp.gmail && GMAIL_MESSAGES[sp.gmail] ? sp.gmail : null;
  const gmailOk = gmailStatus === "connected";

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">API keys, search settings, and keyword filters.</p>
      </div>
      {gmailStatus && (
        <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
          gmailOk
            ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
            : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
        }`}>
          {gmailOk ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
          <span>
            {GMAIL_MESSAGES[gmailStatus]}
            {sp.detail && ` (${sp.detail})`}
          </span>
        </div>
      )}
      <SettingsForm
        initial={settings}
        igAccounts={igAccounts}
      />
    </div>
  );
}
