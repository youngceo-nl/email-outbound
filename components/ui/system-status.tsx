import Link from "next/link";
import { Instagram } from "lucide-react";

type CookieStatus = "ok" | "unknown" | "missing" | "dead";

export type SystemStatusProps = {
  igStatus: CookieStatus;
};

// ok = green, unknown = gray, missing = amber, dead = red
function StatusDot({ status }: { status: CookieStatus }) {
  if (status === "ok")      return <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />;
  if (status === "unknown") return <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 shrink-0" />;
  if (status === "missing") return <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />;
  return <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />;
}

const COOKIE_LABEL: Record<CookieStatus, (prefix: string) => string> = {
  ok:      (p) => p,
  unknown: (p) => `${p}: not verified`,
  missing: (p) => `${p}: no cookie`,
  dead:    (p) => `${p}: expired`,
};

export function SystemStatus({ igStatus }: SystemStatusProps) {
  return (
    <div className="px-2 py-1.5">
      <Link
        href="/settings#instagram"
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors py-0.5"
      >
        <StatusDot status={igStatus} />
        <Instagram className="h-3 w-3 shrink-0" />
        <span>{COOKIE_LABEL[igStatus]("IG")}</span>
      </Link>
    </div>
  );
}
