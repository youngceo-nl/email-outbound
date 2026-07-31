import { redirect } from "next/navigation";

// Review moved into the Leads page as a tab — see app/(dashboard)/leads/page.tsx.
export default function ReviewRedirectPage() {
  redirect("/leads?tab=review");
}
