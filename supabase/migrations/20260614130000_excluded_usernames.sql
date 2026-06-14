-- Excluded usernames: a permanent "do not re-add" list. When a lead is deleted
-- in bulk from the Leads table, its username is recorded here so the crawler
-- never re-inserts it as a fresh `pending` duplicate on a later run.

create table if not exists public.excluded_usernames (
  username     text primary key,
  reason       text,                                          -- e.g. "bulk_delete"
  excluded_by  uuid references auth.users(id) on delete set null,
  excluded_at  timestamptz not null default now()
);

create index if not exists excluded_usernames_excluded_at_idx
  on public.excluded_usernames (excluded_at desc);

alter table public.excluded_usernames enable row level security;
drop policy if exists excluded_usernames_all on public.excluded_usernames;
create policy excluded_usernames_all on public.excluded_usernames
  for all to authenticated using (true) with check (true);
