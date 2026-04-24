-- Outreach: per-lead "Send email" button. Tracks every send + a single
-- template stored on app_settings.

create table if not exists public.outreach_messages (
  id           uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads(id) on delete cascade,
  to_email    text not null,
  subject     text not null,
  body_text   text,
  body_html   text,
  status      text not null default 'sent' check (status in ('sent','failed')),
  message_id  text,
  error       text,
  sent_by     uuid references auth.users(id) on delete set null,
  sent_at     timestamptz not null default now()
);

create index if not exists outreach_messages_lead_idx    on public.outreach_messages (lead_id, sent_at desc);
create index if not exists outreach_messages_sent_at_idx on public.outreach_messages (sent_at desc);

alter table public.outreach_messages enable row level security;
drop policy if exists outreach_messages_all on public.outreach_messages;
create policy outreach_messages_all on public.outreach_messages
  for all to authenticated using (true) with check (true);

-- Latest send + a denormalised counter on the lead row so the leads table
-- can show "Sent 2 emails · last 3d ago" without a join.
alter table public.leads
  add column if not exists outreach_count        integer not null default 0,
  add column if not exists last_outreach_at      timestamptz,
  add column if not exists last_outreach_error   text;

-- Template + reply-to live on the singleton settings row.
alter table public.app_settings
  add column if not exists outreach_subject_template text not null
    default 'Quick idea for {{first_name}}',
  add column if not exists outreach_body_template text not null
    default E'Hey {{first_name}},\n\nI came across @{{username}} — love what you''re doing with {{niche}}.\n\nQuick reason for reaching out: [your hook here]\n\nWould a 15-min call next week be worth it?\n\n— {{sender_name}}',
  add column if not exists outreach_reply_to text;
