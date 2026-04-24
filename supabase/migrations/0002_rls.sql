-- =============================================================================
-- 0002_rls.sql — RLS policies. Service role bypasses RLS automatically.
-- All authenticated users can read/write everything (single-tenant tool).
-- If you go multi-tenant, add an `owner_id uuid references auth.users` column
-- and switch policies to `auth.uid() = owner_id`.
-- =============================================================================

alter table public.app_settings enable row level security;
alter table public.seeds        enable row level security;
alter table public.leads        enable row level security;
alter table public.crawl_jobs   enable row level security;
alter table public.crawl_logs   enable row level security;
alter table public.error_logs   enable row level security;
alter table public.lead_notes   enable row level security;

-- helper: drop & recreate so reruns work
do $$
declare
  t text;
begin
  for t in
    select unnest(array['app_settings','seeds','leads','crawl_jobs','crawl_logs','error_logs','lead_notes'])
  loop
    execute format('drop policy if exists "%1$s_select" on public.%1$s', t);
    execute format('drop policy if exists "%1$s_modify" on public.%1$s', t);
    execute format('create policy "%1$s_select" on public.%1$s for select to authenticated using (true)', t);
    execute format('create policy "%1$s_modify" on public.%1$s for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
