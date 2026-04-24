// Smoke test for Gmail SMTP. Run with:
//   node --env-file=.env.local scripts/test-email.cjs
const nodemailer = require("nodemailer");

(async () => {
  const user = process.env.GMAIL_USER;
  const pass = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
  const fromName = process.env.GMAIL_FROM_NAME?.trim();
  if (!user || !pass) {
    console.error("Missing GMAIL_USER or GMAIL_APP_PASSWORD");
    process.exit(1);
  }
  const t = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  await t.verify();
  const info = await t.sendMail({
    from: fromName ? `${fromName} <${user}>` : user,
    to: user,
    subject: "Outreach SMTP smoke test",
    text: "If you're reading this, Gmail SMTP is wired up correctly.",
    html: "<p>If you're reading this, <b>Gmail SMTP is wired up correctly.</b></p>",
  });
  console.log("OK", { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected });
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
