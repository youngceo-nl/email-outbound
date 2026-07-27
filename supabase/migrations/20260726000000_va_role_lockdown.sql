-- VA-tier access lockdown (docs/va-access-restrictions.md). A VA account is
-- tagged with `app_metadata.role = 'va'` on the Supabase Auth user (set via
-- the Admin API, not stored in any table) — that claim rides along on the
-- user's JWT, which `auth.jwt()` reads from directly in RLS.
--
-- Every real read/write in this app already goes through the service-role
-- admin client in server actions (verified: grepped every `.from("leads")` /
-- `.from("app_settings")` / `.from("rejected_leads")` call in app/actions and
-- app/api — all use createAdminClient(), which bypasses RLS entirely). So
-- this lockdown changes nothing about how the app behaves for a VA using the
-- UI; it only stops a VA session from reading these tables directly via the
-- public anon key (e.g. from the browser console), which was previously wide
-- open like every other table.
create or replace function public.is_va() returns boolean
language sql stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'va', false);
$$;

-- app_settings holds live secrets (openai_api_key, apify_api_keys, ...).
drop policy if exists "app_settings_select" on public.app_settings;
drop policy if exists "app_settings_modify" on public.app_settings;
create policy "app_settings_select" on public.app_settings
  for select to authenticated using (not is_va());
create policy "app_settings_modify" on public.app_settings
  for all to authenticated using (not is_va()) with check (not is_va());

-- rejected_leads is the "bad leads" data — explicitly asked to be hidden.
drop policy if exists rejected_leads_all on public.rejected_leads;
create policy rejected_leads_all on public.rejected_leads
  for all to authenticated using (not is_va()) with check (not is_va());

-- Billing / cost data — not a VA concern.
drop policy if exists api_usage_events_all on public.api_usage_events;
create policy api_usage_events_all on public.api_usage_events
  for all to authenticated using (not is_va()) with check (not is_va());

drop policy if exists fixed_costs_all on public.fixed_costs;
create policy fixed_costs_all on public.fixed_costs
  for all to authenticated using (not is_va()) with check (not is_va());

-- leads: hide exactly the rows the /review queue surfaces — status
-- 'qualified' with no review_decision yet (app/actions/review.ts's
-- getReviewQueue() criteria) — mirroring the page-level restriction at the
-- database layer. A VA can still see/work every other lead.
drop policy if exists "leads_select" on public.leads;
drop policy if exists "leads_modify" on public.leads;
create policy "leads_select" on public.leads
  for select to authenticated
  using (not is_va() or not (status = 'qualified' and review_decision is null));
create policy "leads_modify" on public.leads
  for all to authenticated
  using (not is_va() or not (status = 'qualified' and review_decision is null))
  with check (not is_va() or not (status = 'qualified' and review_decision is null));
