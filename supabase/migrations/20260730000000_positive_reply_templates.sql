-- Positive-reply templates (docs/instantly-fying-outreachpage/leadpipelinetocampaign.md):
-- a campaign can hold one canned reply template, authored once, shown to the
-- VA whenever a reply on that campaign gets classified 'positive' by the
-- existing sentiment classifier. Rendered the same way outreach templates
-- already are (lib/outreach/template.ts's buildLeadContext/renderTemplate).
alter table public.campaigns
  add column if not exists positive_reply_template text;

-- Tracks that a human sent an in-app reply to a specific inbound message —
-- powers the "you replied on ..." annotation and prevents the compose box
-- from silently looking unsent after a real send.
alter table public.inbox_messages
  add column if not exists replied_at timestamptz,
  add column if not exists reply_sent_by uuid references auth.users(id) on delete set null;
