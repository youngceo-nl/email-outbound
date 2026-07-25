-- Generated opportunity reports, one row per generation.
--
-- Reports are kept rather than regenerated on demand: the document quotes figures
-- as observed on a date, and a prospect who opens a link a week later must see the
-- same numbers the strategist approved. Regenerating would silently re-resolve
-- assumptions against newer scrape data and change what was already sent.

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,

  -- queued -> generating -> ready | failed
  status text not null default 'queued',

  -- The full ReportContent document (lib/report/schema.ts). Everything the
  -- renderer needs; deliberately excludes the logo and prospect photo, which are
  -- large base64 blobs regenerated at render time.
  content_json jsonb,

  -- The resolved scenario inputs and the calculator's outputs, stored alongside
  -- the formula version that produced them. Without this a formula change would
  -- silently reinterpret old reports.
  inputs_json jsonb,
  scenarios_json jsonb,
  formula_version text,

  -- Which inputs a human overrode, and who. Kept separate from inputs_json so
  -- "what did we assume" and "what did someone confirm" stay distinguishable.
  overrides_json jsonb,
  confirmed_by text,

  -- Path within the `reports` storage bucket. Null until the PDF is rendered.
  pdf_path text,

  error text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reports_lead_id_idx on public.reports (lead_id);
create index if not exists reports_status_idx on public.reports (status);
create index if not exists reports_created_at_idx on public.reports (created_at desc);

-- Same posture as every other table in this app: single-tenant, any authenticated
-- user can read and write, and the Inngest functions use the service-role key to
-- bypass RLS entirely.
alter table public.reports enable row level security;

drop policy if exists "reports_authenticated_all" on public.reports;
create policy "reports_authenticated_all" on public.reports
  for all to authenticated using (true) with check (true);

-- Private bucket for the rendered PDFs. Not public: a report names a prospect and
-- quotes their revenue, so it is served through a signed URL from an authenticated
-- route, never by guessing a path.
insert into storage.buckets (id, name, public)
values ('reports', 'reports', false)
on conflict (id) do nothing;
