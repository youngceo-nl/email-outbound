"use client";
import { useTransition, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle } from "lucide-react";
import { saveSettings } from "@/app/actions/settings";
import { BurnerCookieManager } from "@/components/settings/burner-cookie-manager";
import { YtCookieManager } from "@/components/settings/yt-cookie-manager";
import type { AppSettings } from "@/lib/types";

export function SettingsForm({ initial }: { initial: AppSettings }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [isDirty, setIsDirty] = useState(false);

  const markDirty = useCallback(() => setIsDirty(true), []);

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
      await saveSettings(initial, fd);
      setIsDirty(false);
      router.refresh();
    });
  };

  return (
    <>
      <form id="settings-form" onChange={markDirty} onSubmit={handleSubmit} className="space-y-6 pb-24">
        <Card>
          <CardHeader><CardTitle>API keys</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Field label="Apify API key (optional)" name="apify_api_key" defaultValue={initial.apify_api_key ?? ""} type="password" hint="Falls back to APIFY_TOKEN env var if blank." />
            <Field label="ScrapingBee API key" name="scrapingbee_api_key" defaultValue={initial.scrapingbee_api_key ?? ""} type="password" hint="Falls back to SCRAPINGBEE_API_KEY env var if blank." />
            <Field label="Serper.dev API key" name="serper_api_key" defaultValue={initial.serper_api_key ?? ""} type="password" hint="Google Search API used to find LinkedIn/YouTube profiles. Falls back to SERPER_API_KEY env var." />

            <div className="space-y-1 pt-2">
              <Label className="text-sm">Scoring provider</Label>
              <select name="scoring_provider" defaultValue={initial.scoring_provider}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                <option value="openai">OpenAI (gpt-4o-mini)</option>
                <option value="claude">Claude (Anthropic)</option>
              </select>
            </div>

            <Field label="OpenAI API key" name="openai_api_key" defaultValue={initial.openai_api_key ?? ""} type="password" hint="Falls back to OPENAI_API_KEY env var if blank." />
            <Field label="OpenAI model" name="openai_model" defaultValue={initial.openai_model} hint="gpt-4o-mini (cheap, fast) or gpt-4o (better)" />
            <Field label="Claude (Anthropic) API key" name="claude_api_key" defaultValue={initial.claude_api_key ?? ""} type="password" hint="Used only when scoring provider is Claude." />
            <Field label="Claude model" name="claude_model" defaultValue={initial.claude_model} hint="e.g. claude-opus-4-7, claude-sonnet-4-6" />
            <Separator />
            <Field label="CapSolver API key" name="capsolver_api_key" defaultValue={initial.capsolver_api_key ?? ""} type="password" hint="Solves reCAPTCHA when revealing gated business emails on YouTube. Falls back to CAPSOLVER_API_KEY env var." />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Cookie management</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <p className="text-sm font-medium">Instagram cookies</p>
              <p className="text-xs text-muted-foreground">Burner accounts used to scrape following lists. The scraper rotates automatically when one gets rate-limited.</p>
              <BurnerCookieManager cookies={initial.instagram_session_cookies ?? []} />
            </div>
            <Separator />
            <div className="space-y-2">
              <p className="text-sm font-medium">YouTube cookies</p>
              <p className="text-xs text-muted-foreground">Logged-in Google accounts used to scrape About pages and reveal gated business emails. Rotates when one expires.</p>
              <YtCookieManager cookies={initial.yt_google_cookies ?? []} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Instagram search settings</CardTitle>
            <p className="text-sm text-muted-foreground">Controls how deep we crawl through Instagram following lists when a source account search runs.</p>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Field label="How many levels deep to search" name="max_crawl_depth" type="number" defaultValue={String(initial.max_crawl_depth)} hint="Level 1 = people the source account follows. Level 2 also checks who those people follow. Higher means more leads but more cost." />
            <Field label="Accounts to check per source" name="max_profiles_per_account" type="number" defaultValue={String(initial.max_profiles_per_account)} hint="How many accounts to look at from each source before stopping." />
            <Field label="Go deeper when a lead scores at least" name="crawl_score_threshold" type="number" step="0.1" defaultValue={String(initial.crawl_score_threshold)} hint="When a lead scores this high (0–10), we also search the people they follow." />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Automatic lookups</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Toggle
              name="enrich_funnels_auto"
              defaultChecked={initial.enrich_funnels_auto}
              label="Automatically find offers for qualified leads"
              hint="When a lead qualifies, open the link in their bio to find the product or program they sell. Costs ~10–25 credits per qualified lead."
            />
            <Toggle
              name="enrich_emails_auto"
              defaultChecked={initial.enrich_emails_auto}
              label="Automatically find emails for qualified leads"
              hint="When a lead qualifies, look up their email address. Costs credits per lead. Off by default — most people prefer the manual 'Find email' button."
            />
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
          <CardHeader><CardTitle>Gmail (outreach sender)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Field label="Gmail address" name="gmail_user" defaultValue={initial.gmail_user ?? ""} hint="The Gmail account used to send outreach. Falls back to GMAIL_USER env var." />
            <Field label="App password" name="gmail_app_password" defaultValue={initial.gmail_app_password ?? ""} type="password" hint="Generate one at myaccount.google.com → Security → App passwords. Falls back to GMAIL_APP_PASSWORD env var." />
            <Field label="Sender name (optional)" name="gmail_from_name" defaultValue={initial.gmail_from_name ?? ""} hint={"Shown as the \"From\" name in the recipient's inbox. Falls back to GMAIL_FROM_NAME env var."} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Outreach template</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Field
              label="Subject"
              name="outreach_subject_template"
              defaultValue={initial.outreach_subject_template}
              hint="Placeholders: {{first_name}} {{full_name}} {{username}} {{niche}} {{business_model}} {{program_name}} {{sender_name}}"
            />
            <div className="space-y-1">
              <Label className="text-sm">Body</Label>
              <Textarea
                name="outreach_body_template"
                defaultValue={initial.outreach_body_template}
                rows={8}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Same placeholders. Use <code>{"{{first_name|there}}"}</code> for a fallback. You can also edit subject/body per-lead before sending.
              </p>
            </div>
            <Field
              label="Reply-To (optional)"
              name="outreach_reply_to"
              defaultValue={initial.outreach_reply_to ?? ""}
              hint="If set, replies route here instead of the Gmail address used to send."
            />
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
                onClick={() => { setIsDirty(false); router.refresh(); }}
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

function Toggle({
  name, defaultChecked, label, hint,
}: { name: string; defaultChecked: boolean; label: string; hint?: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={name} className="flex items-center gap-2 text-sm font-medium cursor-pointer">
        <input
          id={name}
          name={name}
          type="checkbox"
          defaultChecked={defaultChecked}
          className="h-4 w-4 rounded border-input"
        />
        {label}
      </label>
      {hint && <p className="text-xs text-muted-foreground pl-6">{hint}</p>}
    </div>
  );
}
