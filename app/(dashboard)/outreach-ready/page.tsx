import { redirect } from "next/navigation";

// Outreach Ready moved into the Outreach page as the Ad-hoc tab — see
// app/(dashboard)/campaigns/page.tsx.
export default function OutreachReadyRedirectPage() {
  redirect("/campaigns?tab=adhoc");
}
