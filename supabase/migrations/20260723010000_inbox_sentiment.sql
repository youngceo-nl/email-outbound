-- Sentiment classification of inbound replies (positive/neutral/negative),
-- set once by syncInbox() right after a reply is first inserted. Drives the
-- "positive replies to Discord" alert — null means not yet classified.
alter table public.inbox_messages
  add column if not exists sentiment text
    check (sentiment in ('positive', 'neutral', 'negative'));
