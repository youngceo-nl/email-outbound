"use client";
import { useTransition, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RefreshCw, CheckCircle2, XCircle, Eye, EyeOff } from "lucide-react";
import { refreshYtCookieNow } from "@/app/actions/settings";

type Status = "idle" | "refreshing" | "ok" | "error";

export function YtLoginManager({
  initialEmail,
  initialCookieSet,
}: {
  initialEmail: string | null;
  initialCookieSet: boolean;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [pending, start] = useTransition();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const totpRef = useRef<HTMLInputElement>(null);

  const handleRefresh = () => {
    setStatus("refreshing");
    setMsg(null);
    start(async () => {
      const r = await refreshYtCookieNow({
        email: emailRef.current?.value || undefined,
        password: passwordRef.current?.value || undefined,
        totpSecret: totpRef.current?.value || undefined,
      });
      if (r.ok) {
        setStatus("ok");
        setMsg("Cookie refreshed successfully — YouTube enrichment is live.");
      } else {
        setStatus("error");
        setMsg(r.error ?? "Login failed");
      }
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Enter the credentials of a Google/YouTube account. The system logs in automatically and keeps the cookie fresh — no manual pasting needed.
        Use a dedicated burner account, not your personal Google account.
      </p>

      {/* These inputs are part of the parent settings form, so they submit via the form's Save button */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="yt_google_email" className="text-sm">Google email</Label>
          <Input
            ref={emailRef}
            id="yt_google_email"
            name="yt_google_email"
            type="email"
            defaultValue={initialEmail ?? ""}
            placeholder="burner@gmail.com"
            autoComplete="off"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="yt_google_password" className="text-sm">Password</Label>
          <div className="relative">
            <Input
              ref={passwordRef}
              id="yt_google_password"
              name="yt_google_password"
              type={showPw ? "text" : "password"}
              placeholder="••••••••"
              autoComplete="new-password"
              className="pr-9"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPw(v => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="yt_google_totp_secret" className="text-sm">
          Authenticator secret <span className="text-muted-foreground font-normal">(optional — only if 2FA is enabled)</span>
        </Label>
        <Input
          ref={totpRef}
          id="yt_google_totp_secret"
          name="yt_google_totp_secret"
          type="password"
          placeholder="Base32 secret from your authenticator app"
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          In Google Authenticator / Authy: export or reveal the secret for this account. Starts with letters like JBSWY3DP…
        </p>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={handleRefresh}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${pending ? "animate-spin" : ""}`} />
          {pending ? "Logging in…" : "Login & refresh cookie now"}
        </Button>

        {status === "ok" && (
          <span className="flex items-center gap-1 text-sm text-green-600">
            <CheckCircle2 className="h-4 w-4" /> {msg}
          </span>
        )}
        {status === "error" && (
          <span className="flex items-center gap-1 text-sm text-destructive">
            <XCircle className="h-4 w-4" /> {msg}
          </span>
        )}
        {status === "idle" && initialCookieSet && (
          <span className="text-xs text-muted-foreground">Cookie currently set — auto-refreshes every 12h via Inngest</span>
        )}
        {status === "idle" && !initialCookieSet && (
          <span className="text-xs text-amber-600">No cookie set — save credentials and click Login to activate</span>
        )}
      </div>
    </div>
  );
}
