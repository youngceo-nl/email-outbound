import { redirect } from "next/navigation";

// Activity page removed — the live activity drawer (available from every
// page) is now the only Activity surface, and its pipeline stats moved to
// the Dashboard. See app/(dashboard)/page.tsx and components/logs/activity-drawer.tsx.
export default function LogsRedirectPage() {
  redirect("/");
}
