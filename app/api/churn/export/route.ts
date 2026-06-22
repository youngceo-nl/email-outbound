import { createAdminClient } from "@/lib/supabase/admin";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

function esc(v: string | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET() {
  const sb = createAdminClient();
  const { data } = await sb
    .from("leads")
    .select("username, full_name, profile_url, overall_score, niche, followers, bio, external_link, youtube_url, linkedin_url")
    .eq("status", "qualified")
    .is("email", null)
    .not("enriched_at", "is", null)
    .eq("outreach_count", 0)
    .order("overall_score", { ascending: false })
    .limit(500);

  const rows = (data ?? []) as Partial<Lead>[];

  const headers = ["score", "username", "full_name", "instagram_url", "niche", "followers", "website", "youtube", "linkedin", "bio"];
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      [
        esc(r.overall_score != null ? Number(r.overall_score).toFixed(1) : null),
        esc(r.username),
        esc(r.full_name),
        esc(r.profile_url),
        esc(r.niche),
        esc(r.followers != null ? String(r.followers) : null),
        esc(r.external_link),
        esc(r.youtube_url),
        esc(r.linkedin_url),
        esc(r.bio),
      ].join(",")
    ),
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="churn-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
