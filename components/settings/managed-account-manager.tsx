"use client";
import { useTransition, useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, MinusCircle, RefreshCw, Trash2, Eye, EyeOff, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { addManagedAccount, refreshManagedAccount } from "@/app/actions/settings";
import type { ManagedAccountDisplay } from "@/lib/types";

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function statusLabel(account: ManagedAccountDisplay): { color: string; text: string; Icon: React.ElementType } {
  if (account.cookie && !account.last_error) return { color: "text-green-600", text: "Active", Icon: CheckCircle2 };
  if (account.cookie && account.last_error) return { color: "text-amber-600", text: "Active (refresh failed)", Icon: AlertTriangle };
  if (!account.cookie && account.last_error) return { color: "text-destructive", text: "Login failed", Icon: XCircle };
  return { color: "text-muted-foreground", text: "Not logged in", Icon: MinusCircle };
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="text-muted-foreground hover:text-foreground transition-colors"
      aria-label="Copy cookie"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function AccountCard({
  account,
  platform,
  onRefresh,
  onRemove,
  refreshing,
}: {
  account: ManagedAccountDisplay;
  platform: "instagram" | "youtube";
  onRefresh: () => void;
  onRemove: () => void;
  refreshing: boolean;
}) {
  const { color, text, Icon } = statusLabel(account);
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="rounded-md border bg-card">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={`h-3.5 w-3.5 shrink-0 ${color}`} />
          <span className="text-sm font-medium truncate">{account.label}</span>
          <span className={`text-xs ${color} shrink-0`}>{text}</span>
          <span className="text-xs text-muted-foreground shrink-0">
            · refreshed {relativeTime(account.cookie_set_at)}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {confirmDelete ? (
            <>
              <span className="text-xs text-muted-foreground mr-1">Remove?</span>
              <Button type="button" size="sm" variant="destructive" className="h-7 px-2 text-xs"
                onClick={onRemove}>Yes</Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs"
                onClick={() => setConfirmDelete(false)}>Cancel</Button>
            </>
          ) : (
            <>
              <Button
                type="button" size="icon" variant="ghost" disabled={refreshing}
                onClick={onRefresh} aria-label="Refresh cookie" className="h-7 w-7"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              </Button>
              <Button
                type="button" size="icon" variant="ghost"
                onClick={() => setConfirmDelete(true)} aria-label="Remove account" className="h-7 w-7"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Cookie row — collapsed by default */}
      <div className="border-t bg-muted/30 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>{platform === "instagram" ? "Session cookie" : "Google cookie"}</span>
            <span className="text-muted-foreground/60">{expanded ? "▲" : "▼"}</span>
          </button>
          {account.cookie && expanded && <CopyButton value={account.cookie} />}
        </div>

        {expanded && (
          <div className="mt-2">
            {account.cookie ? (
              <p className="font-mono text-xs text-foreground/80 break-all leading-relaxed">
                {account.cookie}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground italic">No cookie — log in to generate one</p>
            )}
          </div>
        )}
      </div>

      {/* Error row */}
      {account.last_error && (
        <div className="border-t px-3 py-1.5">
          <p className="text-xs text-destructive" title={account.last_error}>
            Last error: {account.last_error}
          </p>
        </div>
      )}
    </div>
  );
}

export function ManagedAccountManager({
  platform,
  accounts,
  onPendingDelete,
}: {
  platform: "instagram" | "youtube";
  accounts: ManagedAccountDisplay[];
  onPendingDelete?: (id: string) => void;
}) {
  const isIg = platform === "instagram";
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set());
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
  const [, startGlobal] = useTransition();

  const [label, setLabel] = useState("");
  const [password, setPassword] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [addPending, startAdd] = useTransition();
  const [addResult, setAddResult] = useState<{ ok?: true; error?: string } | null>(null);

  const setRefreshing = (id: string, val: boolean) =>
    setRefreshingIds((prev) => { const s = new Set(prev); val ? s.add(id) : s.delete(id); return s; });

  const handleRefresh = (id: string) => {
    setRefreshing(id, true);
    startGlobal(async () => {
      await refreshManagedAccount(platform, id);
      setRefreshing(id, false);
    });
  };

  // Queue the deletion locally — parent commits it on form Save, cancels on Discard.
  const handleRemove = (id: string) => {
    setPendingDeleteIds((prev) => { const s = new Set(prev); s.add(id); return s; });
    onPendingDelete?.(id);
  };

  const handleAdd = () => {
    if (!label.trim() || !password.trim()) return;
    setAddResult(null);
    startAdd(async () => {
      const res = await addManagedAccount(platform, {
        label: label.trim(),
        password: password.trim(),
        totp_secret: totpSecret.trim() || undefined,
      });
      setAddResult(res ?? { ok: true });
      if (res.ok) { setLabel(""); setPassword(""); setTotpSecret(""); }
    });
  };

  return (
    <div className="space-y-3">
      {/* One card per account — hide ones queued for deletion */}
      {accounts.filter((a) => !pendingDeleteIds.has(a.id)).map((account) => (
        <AccountCard
          key={account.id}
          account={account}
          platform={platform}
          refreshing={refreshingIds.has(account.id)}
          onRefresh={() => handleRefresh(account.id)}
          onRemove={() => handleRemove(account.id)}
        />
      ))}

      {accounts.length > 0 && <Separator />}

      {/* Add account form */}
      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground">Add account</p>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`${platform}-label`} className="text-xs">
              {isIg ? "Instagram username" : "Google email"}
            </Label>
            <Input
              id={`${platform}-label`}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={isIg ? "your_handle" : "burner@gmail.com"}
              autoComplete="off"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${platform}-pw`} className="text-xs">Password</Label>
            <div className="relative">
              <Input
                id={`${platform}-pw`}
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                className="h-8 text-sm pr-8"
              />
              <button type="button" tabIndex={-1} onClick={() => setShowPw((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showPw ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor={`${platform}-totp`} className="text-xs">
            Authenticator secret{" "}
            <span className="text-muted-foreground font-normal">(optional — only if 2FA is enabled)</span>
          </Label>
          <Input
            id={`${platform}-totp`}
            type="password"
            value={totpSecret}
            onChange={(e) => setTotpSecret(e.target.value)}
            placeholder="Base32 secret (JBSWY3DP…)"
            autoComplete="off"
            className="h-8 text-sm"
          />
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={addPending || !label.trim() || !password.trim()}
            onClick={handleAdd}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${addPending ? "animate-spin" : ""}`} />
            {addPending ? "Logging in…" : "Add & login"}
          </Button>

          {addResult?.ok && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> Logged in — cookie is active
            </span>
          )}
          {addResult?.error && (
            <span className="flex items-center gap-1 text-xs text-destructive">
              <XCircle className="h-3.5 w-3.5" />
              <span className="line-clamp-2">{addResult.error}</span>
            </span>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {isIg
          ? "The scraper rotates between accounts automatically when one gets rate-limited. Cookies auto-refresh every 12h."
          : "The enrichment pipeline cycles through accounts for YouTube email reveal. Cookies auto-refresh every 12h."}
      </p>
    </div>
  );
}
