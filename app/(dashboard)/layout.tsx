import Link from "next/link";
import Image from "next/image";
import { LayoutDashboard, Users, Settings, Sprout, LogOut, Handshake, Megaphone, GraduationCap, FlaskConical } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { ActivityDrawerButton } from "@/components/logs/activity-drawer";
import { getReviewPendingCount } from "@/app/actions/review";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/seeds", label: "Scrape Profiles", icon: Sprout },
  { href: "/handover", label: "Enrich Emails", icon: Handshake },
  { href: "/campaigns", label: "Outreach", icon: Megaphone },
  { href: "/test-environment", label: "Test Environment", icon: FlaskConical },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Best-effort — a nav badge should never take the whole shell down.
  const pendingReview = await getReviewPendingCount().catch(() => 0);
  return (
    <div className="grid grid-cols-[220px_1fr] h-screen overflow-hidden">
      <aside className="border-r bg-muted/20 overflow-y-auto">
        <div className="px-5 py-4 border-b">
          <Link href="/" className="flex h-7 items-center">
            <Image
              src="/outbound-system-logo.png"
              alt="Outbound System"
              width={2652}
              height={508}
              className="h-auto w-[165px]"
              priority
            />
          </Link>
        </div>
        <div className="sticky top-0 bg-muted/20">
          <nav className="p-2 space-y-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors"
              >
                <item.icon className="h-4 w-4" />
                {item.label}
                {item.href === "/leads" && pendingReview > 0 && (
                  <span className="ml-auto text-[11px] tabular-nums rounded-full bg-primary/15 text-primary px-1.5 py-0.5 min-w-[1.25rem] text-center">
                    {pendingReview > 99 ? "99+" : pendingReview}
                  </span>
                )}
              </Link>
            ))}

            {/* Activity — opens a live slide-out drawer instead of navigating away */}
            <ActivityDrawerButton />

            <Link
              href="/how-to-use"
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors text-muted-foreground"
            >
              <GraduationCap className="h-4 w-4" />
              How to use
            </Link>
          </nav>
          <form action={signOut} className="p-2 border-t">
            <button
              type="submit"
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-accent w-full"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="overflow-auto">{children}</main>
    </div>
  );
}
