"use client";

export type LeadEditPayload = {
  leadId: string;
  full_name: string | null;
  niche: string | null;
  bio: string | null;
  external_link: string | null;
  status: string | null;
  // Read-only in the dialog — enough to render the email + enrichment state
  // via describeLeadEmail (lib/leads/email-status.ts).
  email: string | null;
  email_v2: string | null;
  email_provider: string | null;
  email_v2_provider: string | null;
  email_status: string | null;
  email_v2_status: string | null;
  enriched_at: string | null;
  handover_enriched_at: string | null;
};

export function DoubleClickRow({
  payload,
  children,
  className,
}: {
  payload: LeadEditPayload;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <tr
      className={className}
      onDoubleClick={(e) => {
        // Don't trigger when the user double-clicks an interactive element
        const target = e.target as HTMLElement;
        if (target.closest("a,button,input,textarea,select,[role=button]")) return;
        window.dispatchEvent(new CustomEvent("edit-lead", { detail: payload }));
      }}
    >
      {children}
    </tr>
  );
}
