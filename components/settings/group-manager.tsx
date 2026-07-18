"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Plus, Zap, Trash2, AlertTriangle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AccountCard } from "@/components/settings/managed-account-manager";
import {
  addManagedAccount,
  addInstagramGroup,
  removeInstagramGroup,
  setActiveAccountGroup,
  setProxyPool,
} from "@/app/actions/settings";
import type { ManagedAccountDisplay } from "@/lib/types";

const SLOTS = 5;

export function GroupManager({
  groups: initialGroups,
  accounts,
  activeGroup: initialActiveGroup,
  proxyPool: initialProxyPool,
  onPendingDelete,
}: {
  groups: string[];
  accounts: ManagedAccountDisplay[];
  activeGroup: string | null;
  proxyPool: string[];
  onPendingDelete?: (id: string) => void;
}) {
  const router = useRouter();
  const [groups, setGroups] = useState(initialGroups);
  const [activeGroup, setActiveGroupLocal] = useState<string | null>(initialActiveGroup);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());
  const [proxyDraft, setProxyDraft] = useState(initialProxyPool.join("\n"));
  const [addingGroup, startAddGroup] = useTransition();
  const [activating, startActivate] = useTransition();
  const [savingPool, startSavePool] = useTransition();
  const [removing, startRemove] = useTransition();

  const proxyLines = proxyDraft.split("\n").map((l) => l.trim()).filter(Boolean);

  const handleAddGroup = () => {
    const used = new Set(groups);
    const next = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").find((l) => !used.has(l)) ?? `G${groups.length + 1}`;
    startAddGroup(async () => {
      await addInstagramGroup(next);
      setGroups((g) => [...g, next]);
      setExpanded((e) => new Set([...e, next]));
    });
  };

  const handleActivate = (group: string) => {
    const next = activeGroup === group ? null : group;
    startActivate(async () => {
      await setActiveAccountGroup(next);
      setActiveGroupLocal(next);
    });
  };

  const handleRemoveGroup = (group: string) => {
    startRemove(async () => {
      await removeInstagramGroup(group);
      if (activeGroup === group) {
        await setActiveAccountGroup(null);
        setActiveGroupLocal(null);
      }
      setGroups((g) => g.filter((x) => x !== group));
      router.refresh();
    });
  };

  const handleRemoveAccount = (id: string) => {
    setPendingDeletes((s) => { const n = new Set(s); n.add(id); return n; });
    onPendingDelete?.(id);
  };

  const handleSavePool = () => {
    startSavePool(async () => {
      await setProxyPool(proxyLines);
      router.refresh();
    });
  };

  const toggleExpand = (group: string) => {
    setExpanded((e) => {
      const n = new Set(e);
      n.has(group) ? n.delete(group) : n.add(group);
      return n;
    });
  };

  return (
    <div className="space-y-3">
      {/* IP pool */}
      <div className="rounded-md border p-3 space-y-2">
        <p className="text-xs font-medium">IP pool</p>
        <p className="text-[11px] text-muted-foreground">
          5 proxies, one per line. Each account in the active group gets one by slot position (slot 1 → IP 1, slot 2 → IP 2, …).
        </p>
        <Textarea
          value={proxyDraft}
          onChange={(e) => setProxyDraft(e.target.value)}
          placeholder={
            "http://user:pass@ip1:port\nhttp://user:pass@ip2:port\nhttp://user:pass@ip3:port\nhttp://user:pass@ip4:port\nhttp://user:pass@ip5:port"
          }
          className="font-mono text-xs resize-none"
          rows={5}
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={savingPool}
          onClick={handleSavePool}
        >
          {savingPool ? "Saving…" : "Save IPs"}
        </Button>
      </div>

      {/* Group cards */}
      {groups.map((group) => {
        const groupAccounts = accounts.filter(
          (a) => (a.group?.trim() || null) === group && !pendingDeletes.has(a.id),
        );
        const isActive = activeGroup === group;
        const isExpanded = expanded.has(group);

        return (
          <div key={group} className="rounded-md border overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2.5 bg-muted/30">
              <button
                type="button"
                onClick={() => toggleExpand(group)}
                className="flex items-center gap-2 flex-1 min-w-0 text-left"
              >
                {isExpanded
                  ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                <span className="text-sm font-medium">Group {group}</span>
                <span className="text-xs text-muted-foreground">{groupAccounts.length}/{SLOTS} accounts</span>
                {isActive && (
                  <Badge className="text-[10px] h-4 px-1.5 py-0 gap-0.5">
                    <Zap className="h-2.5 w-2.5" />Active
                  </Badge>
                )}
                {(() => {
                  const checkpoints = groupAccounts.filter((a) => a.checkpoint_state).length;
                  const errors = groupAccounts.filter((a) => !a.checkpoint_state && a.last_error).length;
                  return (
                    <>
                      {checkpoints > 0 && (
                        <span className="flex items-center gap-0.5 text-[11px] font-medium text-amber-600">
                          <AlertTriangle className="h-3 w-3" />{checkpoints}
                        </span>
                      )}
                      {errors > 0 && (
                        <span className="flex items-center gap-0.5 text-[11px] font-medium text-destructive">
                          <XCircle className="h-3 w-3" />{errors}
                        </span>
                      )}
                    </>
                  );
                })()}
              </button>
              <Button
                type="button"
                size="sm"
                variant={isActive ? "default" : "outline"}
                className="h-7 px-2 text-xs shrink-0"
                disabled={activating}
                onClick={() => handleActivate(group)}
              >
                {isActive ? "Deactivate" : "Activate"}
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                disabled={removing}
                onClick={() => handleRemoveGroup(group)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Slots */}
            {isExpanded && (
              <div className="divide-y">
                {Array.from({ length: SLOTS }, (_, i) => {
                  const account = groupAccounts[i];
                  const ip = proxyLines[i];
                  const ipLabel = ip
                    ? ip.replace(/^https?:\/\/[^@]*@/, "").slice(0, 35)
                    : "no IP assigned";
                  return (
                    <div key={i} className="p-3 space-y-2">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                        Slot {i + 1} · {ipLabel}
                      </p>
                      {account ? (
                        <AccountCard
                          account={account}
                          platform="instagram"
                          onRemove={() => handleRemoveAccount(account.id)}
                        />
                      ) : (
                        <AddAccountSlot group={group} existingAccounts={accounts} onAdded={() => router.refresh()} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 text-xs gap-1.5"
        disabled={addingGroup}
        onClick={handleAddGroup}
      >
        <Plus className="h-3.5 w-3.5" />
        {addingGroup ? "Adding…" : "Add group"}
      </Button>
    </div>
  );
}

function AddAccountSlot({ group, existingAccounts, onAdded }: { group: string; existingAccounts: ManagedAccountDisplay[]; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [email, setEmail] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [csrfToken, setCsrfToken] = useState("");
  const [dsUserId, setDsUserId] = useState("");
  const [rur, setRur] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [pending, startPending] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const assembleCookie = () => {
    const parts: string[] = [];
    if (sessionId.trim()) parts.push(`sessionid=${sessionId.trim()}`);
    if (csrfToken.trim()) parts.push(`csrftoken=${csrfToken.trim()}`);
    if (dsUserId.trim()) parts.push(`ds_user_id=${dsUserId.trim()}`);
    if (rur.trim()) parts.push(`rur="${rur.trim().replace(/^"|"$/g, "")}"`);
    return parts.join("; ");
  };

  const handleAdd = () => {
    setError(null);
    startPending(async () => {
      const res = await addManagedAccount("instagram", {
        label: label.trim(),
        account_email: email.trim() || undefined,
        cookie: sessionId.trim() ? assembleCookie() : undefined,
        password: password.trim() || undefined,
        totp_secret: totp.trim() || undefined,
        group,
      });
      if (res.ok) {
        setOpen(false);
        setLabel(""); setEmail(""); setSessionId(""); setCsrfToken(""); setDsUserId(""); setRur(""); setPassword(""); setTotp("");
        onAdded();
      } else {
        setError(res.error ?? "Failed to add account");
      }
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        Add account
      </button>
    );
  }

  return (
    <div className="space-y-2.5 rounded-md border p-3 bg-muted/20">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Instagram username</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="your_handle"
            autoComplete="off"
            className="h-7 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Account email</Label>
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
            type="email"
            autoComplete="off"
            className={`h-7 text-xs ${email && existingAccounts.some((a) => a.account_email?.toLowerCase() === email.toLowerCase()) ? "border-amber-400 focus-visible:ring-amber-400" : ""}`}
          />
          {email && existingAccounts.some((a) => a.account_email?.toLowerCase() === email.toLowerCase()) && (
            <p className="text-[11px] text-amber-600">
              Already used by @{existingAccounts.find((a) => a.account_email?.toLowerCase() === email.toLowerCase())?.label}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">
          Session cookie{" "}
          <span className="text-muted-foreground font-normal">— F12 → Application → Cookies → instagram.com</span>
        </Label>
        {([
          { label: "Session ID", value: sessionId, set: setSessionId, placeholder: "395860815%3ADkb0mm…" },
          { label: "CSRF Token", value: csrfToken, set: setCsrfToken, placeholder: "RID2FZQRbCj…" },
          { label: "ds_user_id", value: dsUserId, set: setDsUserId, placeholder: "395860815" },
          { label: "RUR",        value: rur,       set: setRur,       placeholder: "CLN\\054…" },
        ] as const).map(({ label: fieldLabel, value, set, placeholder }) => (
          <div key={fieldLabel} className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-20 shrink-0">{fieldLabel}</span>
            <Input
              value={value}
              onChange={(e) => (set as (v: string) => void)(e.target.value)}
              placeholder={placeholder}
              autoComplete="off"
              className="h-7 text-xs font-mono flex-1"
            />
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">
          Password{" "}
          <span className="text-muted-foreground font-normal">— optional, enables auto-refresh every 12h</span>
        </Label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground w-20 shrink-0">Password</span>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Instagram password"
            autoComplete="new-password"
            className="h-7 text-xs flex-1"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground w-20 shrink-0">TOTP secret</span>
          <Input
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
            placeholder="TOTP secret (for 2FA accounts)"
            className="h-7 text-xs flex-1 font-mono"
          />
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 px-2 text-xs"
          disabled={pending || !label.trim() || (!sessionId.trim() && !password.trim())}
          onClick={handleAdd}
        >
          {pending ? "Saving…" : "Add account"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => { setOpen(false); setError(null); }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
