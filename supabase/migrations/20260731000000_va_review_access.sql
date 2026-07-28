-- Restores VA access to the human-review queue (docs/va-access-restrictions.md
-- update, 2026-07-31) — reverses just the `leads` RLS carve-out from the
-- original VA lockdown migration (20260726000000_va_role_lockdown.sql).
-- Every other VA restriction (rejected_leads, app_settings, api_usage_events,
-- fixed_costs) is untouched — only Review access was requested back.
drop policy if exists "leads_select" on public.leads;
drop policy if exists "leads_modify" on public.leads;
create policy "leads_select" on public.leads for select to authenticated using (true);
create policy "leads_modify" on public.leads for all to authenticated using (true) with check (true);
