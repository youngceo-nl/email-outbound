-- Per-category outreach copy. Leads split into three categories derived from
-- business_model (lib/leads/category.ts) — agency -> partnerships,
-- course/coaching -> info, everything else -> other — and each now gets its
-- own subject/body pair instead of sharing the one global template.
--
-- Seeded from the existing outreach_subject_template/outreach_body_template
-- so nothing regresses on migrate: every category starts out sending exactly
-- what it sends today until someone edits it in Settings. The original two
-- columns stay as-is (nothing reads them as a "fallback" — each category
-- column is independently not-null with its own default of the same text).
alter table public.app_settings
  add column if not exists outreach_subject_partnerships text,
  add column if not exists outreach_body_partnerships    text,
  add column if not exists outreach_subject_info          text,
  add column if not exists outreach_body_info              text,
  add column if not exists outreach_subject_other          text,
  add column if not exists outreach_body_other              text;

update public.app_settings
   set outreach_subject_partnerships = coalesce(outreach_subject_partnerships, outreach_subject_template),
       outreach_body_partnerships    = coalesce(outreach_body_partnerships, outreach_body_template),
       outreach_subject_info         = coalesce(outreach_subject_info, outreach_subject_template),
       outreach_body_info            = coalesce(outreach_body_info, outreach_body_template),
       outreach_subject_other        = coalesce(outreach_subject_other, outreach_subject_template),
       outreach_body_other           = coalesce(outreach_body_other, outreach_body_template)
 where id = 1;

alter table public.app_settings
  alter column outreach_subject_partnerships set not null,
  alter column outreach_body_partnerships set not null,
  alter column outreach_subject_info set not null,
  alter column outreach_body_info set not null,
  alter column outreach_subject_other set not null,
  alter column outreach_body_other set not null;
