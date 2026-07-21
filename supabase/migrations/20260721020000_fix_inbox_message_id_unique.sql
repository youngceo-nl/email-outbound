-- app/actions/inbox.ts's syncInbox() upserts on `gmail_message_id` via
-- `.upsert(..., { onConflict: "gmail_message_id" })`, which PostgREST
-- compiles to a plain `ON CONFLICT (gmail_message_id)`. Postgres can only
-- infer that against an unconditional unique constraint/index — it cannot
-- match a *partial* one (the original index had `WHERE gmail_message_id IS
-- NOT NULL`) without the same predicate repeated in the ON CONFLICT clause
-- itself, which the simple upsert API has no way to express. Every live sync
-- attempt therefore failed silently into "0 new replies" — inbox_messages was
-- never actually written to (confirmed empty pre-migration).
--
-- A standard unique constraint doesn't need the partial predicate: Postgres
-- already treats every NULL as distinct from every other NULL under a plain
-- UNIQUE constraint, so multiple NULL gmail_message_id rows were never
-- actually a conflict risk the partial index was protecting against.
drop index if exists public.inbox_messages_gmail_id_uidx;

alter table public.inbox_messages
  add constraint inbox_messages_gmail_message_id_key unique (gmail_message_id);
