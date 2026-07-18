"use client";
import { useTransition, useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle } from "lucide-react";
import { saveSettings, removeManagedAccount } from "@/app/actions/settings";
import { GroupManager } from "@/components/settings/group-manager";
import { EmailKeyManager } from "@/components/settings/email-key-manager";
import type { AppSettings, ManagedAccountDisplay } from "@/lib/types";

export function SettingsForm({
  initial,
  igAccounts = [],
}: {
  initial: AppSettings;
  igAccounts?: ManagedAccountDisplay[];
  activeAccountGroup?: string | null;
  instagramProxyPool?: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [isDirty, setIsDirty] = useState(false);
  // Tracks account IDs queued for deletion — committed on Save, cleared on Discard.
  const pendingDeletes = useRef<Array<{ platform: "instagram"; id: string }>>([]);
  // Incrementing this key forces ManagedAccountManager to remount (resetting local state) on Discard.
  const [igResetKey, setIgResetKey] = useState(0);

  const markDirty = useCallback(() => setIsDirty(true), []);

  const addPendingDelete = useCallback((platform: "instagram", id: string) => {
    pendingDeletes.current.push({ platform, id });
    markDirty();
  }, [markDirty]);

  // Warn on browser-level navigation (tab close, refresh, URL change)
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const deletes = pendingDeletes.current.splice(0);
      for (const { platform, id } of deletes) {
        await removeManagedAccount(platform, id);
      }
      await saveSettings(initial, fd);
      setIsDirty(false);
      router.refresh();
    });
  };

  return (
    <>
      <form id="settings-form" onChange={markDirty} onSubmit={handleSubmit} className="space-y-6 pb-24">
        <Card id="email">
          <CardHeader><CardTitle>API keys</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-sm">Apify API keys</Label>
              <p className="text-xs text-muted-foreground">Add multiple accounts to rotate monthly free credits. Falls back to APIFY_TOKENS / APIFY_TOKEN env var.</p>
              <EmailKeyManager provider="apify" keys={initial.apify_api_keys ?? []} placeholder="apify_api_…" showLabel keyStatuses={initial.email_key_statuses ?? {}} />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">ScrapingBee API keys</Label>
              <p className="text-xs text-muted-foreground">Add multiple accounts to rotate credits. Falls back to SCRAPINGBEE_API_KEY env var.</p>
              <EmailKeyManager provider="scrapingbee" keys={initial.scrapingbee_api_keys ?? []} placeholder="SB API key…" keyStatuses={initial.email_key_statuses ?? {}} />
            </div>

            <div className="space-y-1 pt-2">
              <Label className="text-sm">Scoring provider</Label>
              <select name="scoring_provider" defaultValue={initial.scoring_provider}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                <option value="openai">OpenAI (gpt-4o-mini)</option>
                <option value="claude">Claude (Anthropic)</option>
                <option value="gemini">Gemini (Google — free tier)</option>
                <option value="groq">Groq (Llama — free tier)</option>
              </select>
            </div>

            <Field label="OpenAI API key" name="openai_api_key" defaultValue={initial.openai_api_key ?? ""} type="password" hint="Falls back to OPENAI_API_KEY env var if blank." />
            <Field label="OpenAI model" name="openai_model" defaultValue={initial.openai_model} hint="gpt-4o-mini (cheap, fast) or gpt-4o (better)" />
            <Field label="Claude (Anthropic) API key" name="claude_api_key" defaultValue={initial.claude_api_key ?? ""} type="password" hint="Used only when scoring provider is Claude." />
            <Field label="Claude model" name="claude_model" defaultValue={initial.claude_model} hint="e.g. claude-opus-4-7, claude-sonnet-4-6" />
            <Field label="Gemini API key" name="gemini_api_key" defaultValue={initial.gemini_api_key ?? ""} type="password" hint="Free key from aistudio.google.com/apikey. Falls back to GEMINI_API_KEY env var. Note: free tier is not available in the EU/UK/Switzerland." />
            <Field label="Gemini model" name="gemini_model" defaultValue={initial.gemini_model} hint="gemini-2.0-flash is on the free tier" />
            <Field label="Groq API key" name="groq_api_key" defaultValue={initial.groq_api_key ?? ""} type="password" hint="Free key from console.groq.com/keys. Falls back to GROQ_API_KEY env var." />
            <Field label="Groq model" name="groq_model" defaultValue={initial.groq_model} hint="llama-3.3-70b-versatile is on the free tier" />
            <Separator />
            <Field label="CapSolver API key" name="capsolver_api_key" defaultValue={initial.capsolver_api_key ?? ""} type="password" hint="Solves reCAPTCHA during Instagram login checkpoints. Falls back to CAPSOLVER_API_KEY env var." />
            <Field label="Instagram proxy URL (optional)" name="instagram_proxy_url" defaultValue={initial.instagram_proxy_url ?? ""} hint="Rotating proxy for Instagram scraping. Format: http://user:pass@host:port — only used as fallback when a 429 rate-limit is hit. Falls back to INSTAGRAM_PROXY_URL env var." />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Cookie management</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <div id="instagram" className="space-y-2">
              <p className="text-sm font-medium">Instagram accounts</p>
              <p className="text-xs text-muted-foreground">
                Organise accounts into groups of 5. Activate a group to use only those accounts for scraping — switch groups when one gets flagged.
              </p>
              <GroupManager
                key={igResetKey}
                groups={initial.instagram_groups ?? []}
                accounts={igAccounts}
                activeGroup={initial.active_account_group ?? null}
                proxyPool={initial.instagram_proxy_pool ?? []}
                onPendingDelete={(id) => addPendingDelete("instagram", id)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Instagram search settings</CardTitle>
            <p className="text-sm text-muted-foreground">Controls how the Instagram following list crawl behaves when a source account search runs.</p>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Field label="Accounts to check per source" name="max_profiles_per_account" type="number" defaultValue={String(initial.max_profiles_per_account)} hint="How many accounts to look at from each source before stopping." />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Minimum requirements</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Field label="Min followers" name="min_followers" type="number" defaultValue={String(initial.min_followers)} />
            <Field label="Max followers" name="max_followers" type="number" defaultValue={String(initial.max_followers)} />
            <Field label="Min engagement rate (e.g. 0.005 = 0.5%)" name="min_engagement_rate" type="number" step="0.0001" defaultValue={String(initial.min_engagement_rate)} />
            <Field label="Min reels last 30 days" name="min_reels_last_30_days" type="number" defaultValue={String(initial.min_reels_last_30_days ?? 0)} hint="0 = off. Leads are only rejected when we actually captured reels for them." />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Keyword filters</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-sm">Include keywords (comma-separated, OR match)</Label>
              <Textarea name="include_keywords" defaultValue={(initial.include_keywords ?? []).join(", ")} placeholder="coach, course, agency, founder…" />
              <p className="text-xs text-muted-foreground">If set, profile must match at least one. Leave blank to disable.</p>
            </div>
            <Separator />
            <div className="space-y-1">
              <Label className="text-sm">Exclude keywords</Label>
              <Textarea name="exclude_keywords" defaultValue={(initial.exclude_keywords ?? []).join(", ")} placeholder="meme, fan page, news…" />
            </div>
          </CardContent>
        </Card>
      </form>

      {/* Sticky unsaved-changes footer — only visible when the form is dirty */}
      <div className={`fixed bottom-0 left-0 right-0 z-50 transition-transform duration-200 ${isDirty ? "translate-y-0" : "translate-y-full"}`}>
        <div className="border-t bg-background shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
          <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-amber-600">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>You have unsaved changes</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  pendingDeletes.current = [];
                  setIgResetKey((k) => k + 1);
                  setIsDirty(false);
                  router.refresh();
                }}
              >
                Discard
              </Button>
              <Button
                type="submit"
                form="settings-form"
                size="sm"
                disabled={pending}
              >
                {pending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Field({
  label, name, defaultValue, type = "text", step, hint,
}: {
  label: string; name: string; defaultValue: string; type?: string; step?: string; hint?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={name} className="text-sm">{label}</Label>
      <Input id={name} name={name} defaultValue={defaultValue} type={type} step={step} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
