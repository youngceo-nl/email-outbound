import { redirect } from "next/navigation";

// Reports moved into the Outreach page as a tab — see
// app/(dashboard)/campaigns/page.tsx.
export default function ReportsRedirectPage() {
  redirect("/campaigns?tab=reports");
}
