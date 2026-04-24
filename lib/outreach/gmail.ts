import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

let cachedTransport: Transporter | null = null;

function getTransport(): Transporter {
  if (cachedTransport) return cachedTransport;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("GMAIL_USER / GMAIL_APP_PASSWORD not configured");
  cachedTransport = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass: pass.replace(/\s+/g, "") },
  });
  return cachedTransport;
}

export type SendResult = {
  messageId: string;
  accepted: string[];
  rejected: string[];
};

export async function sendEmail(opts: {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  inReplyTo?: string;
  references?: string;
}): Promise<SendResult> {
  const t = getTransport();
  const fromName = process.env.GMAIL_FROM_NAME?.trim();
  const user = process.env.GMAIL_USER!;
  const from = fromName ? `${fromName} <${user}>` : user;

  const info = await t.sendMail({
    from,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
    replyTo: opts.replyTo,
    inReplyTo: opts.inReplyTo,
    references: opts.references,
  });
  return {
    messageId: info.messageId,
    accepted: info.accepted as string[],
    rejected: info.rejected as string[],
  };
}

export async function verifyTransport(): Promise<boolean> {
  const t = getTransport();
  await t.verify();
  return true;
}
