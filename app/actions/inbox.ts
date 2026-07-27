"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/config/settings";
import { syncInboxCore, type SyncInboxResponse } from "@/lib/inbox/sync";
import { sendEmail, gmailReady } from "@/lib/outreach/gmail";
import { textToHtml } from "@/lib/outreach/template";
import { dryRunEnabled } from "@/lib/outreach/send";
import { logCrawl } from "@/lib/pipeline/persist";

// Thin auth+revalidation wrapper — the actual sync logic lives in
// lib/inbox/sync.ts's syncInboxCore, shared with the sync-inbox-scheduled
// Inngest job so replies (and the sentiment the warm-followup chain depends
// on) don't only ever refresh on a manual click.
export async function syncInbox(): Promise<SyncInboxResponse> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const settings = await getSettings();
  const admin = createAdminClient();
  const result = await syncInboxCore(admin, settings);

  revalidatePath("/outreach-ready");
  revalidatePath("/leads");
  return result;
}

export async function markReplyRead(id: string, read = true): Promise<{ ok: boolean }> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false };
  const admin = createAdminClient();
  await admin.from("inbox_messages").update({ is_read: read }).eq("id", id);
  revalidatePath("/outreach-ready");
  return { ok: true };
}

export type SendInboxReplyResponse = { ok: boolean; error?: string; dryRun?: boolean };

// Sends a real in-app reply into the SAME Gmail thread as the original
// conversation — thread id resolved via the reply's outreach_message_id →
// outreach_messages.gmail_thread_id, In-Reply-To/References set to the
// inbound message's own RFC Message-Id so Gmail threads it correctly.
// Deliberately does NOT go through sendOutreachEmailCore: that function's
// guards ("already sent" / "lead has replied — stopped") are about the
// outreach SEQUENCE, and would incorrectly block replying to a lead who —
// by definition here — already replied. This is a distinct send surface,
// reusing the same underlying sendEmail()/gmailReady()/OUTREACH_DRY_RUN.
export async function sendInboxReply(inboxMessageId: string, body: string): Promise<SendInboxReplyResponse> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const bodyText = body.trim();
  if (!bodyText) return { ok: false, error: "Reply is empty." };

  const admin = createAdminClient();
  const { data: msg, error: msgErr } = await admin
    .from("inbox_messages")
    .select("id, from_email, subject, gmail_message_id, outreach_message_id, leads(username)")
    .eq("id", inboxMessageId)
    .single();
  if (msgErr || !msg) return { ok: false, error: msgErr?.message ?? "Reply not found" };
  if (!msg.from_email) return { ok: false, error: "No sender email on this reply." };

  const lead = (Array.isArray(msg.leads) ? msg.leads[0] : msg.leads) as { username?: string } | null;
  const logUsername = lead?.username ?? msg.from_email;

  let threadId: string | undefined;
  if (msg.outreach_message_id) {
    const { data: outreach } = await admin
      .from("outreach_messages")
      .select("gmail_thread_id")
      .eq("id", msg.outreach_message_id)
      .single();
    threadId = outreach?.gmail_thread_id ?? undefined;
  }

  if (dryRunEnabled()) return { ok: true, dryRun: true };

  if (!(await gmailReady())) {
    return { ok: false, error: "Gmail not connected — check the OAuth credentials in Settings." };
  }

  const trimmedSubject = msg.subject?.trim();
  const subject = trimmedSubject ? (/^re:/i.test(trimmedSubject) ? trimmedSubject : `Re: ${trimmedSubject}`) : "Re:";
  const bodyHtml = textToHtml(bodyText);

  try {
    await sendEmail({
      to: msg.from_email,
      subject,
      text: bodyText,
      html: bodyHtml,
      inReplyTo: msg.gmail_message_id ?? undefined,
      references: msg.gmail_message_id ?? undefined,
      threadId,
    });

    await admin
      .from("inbox_messages")
      .update({ replied_at: new Date().toISOString(), reply_sent_by: user.id })
      .eq("id", inboxMessageId);

    await logCrawl({
      crawl_job_id: null,
      profile_username: logUsername,
      parent_username: null,
      action: "inbox_reply_sent",
      depth: 0,
      detail: `To: ${msg.from_email} · Subject: ${subject}`,
    });

    revalidatePath("/outreach-ready");
    revalidatePath("/campaigns");
    return { ok: true };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await logCrawl({
      crawl_job_id: null,
      profile_username: logUsername,
      parent_username: null,
      action: "inbox_reply_failed",
      depth: 0,
      status: "failure",
      detail: errMsg.slice(0, 200),
    });
    return { ok: false, error: errMsg };
  }
}
