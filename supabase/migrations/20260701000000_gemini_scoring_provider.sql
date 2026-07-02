-- Add Gemini as a free scoring provider option.
alter table public.app_settings
  add column if not exists gemini_api_key text,
  add column if not exists gemini_model text not null default 'gemini-2.0-flash';

alter table public.app_settings
  drop constraint if exists app_settings_scoring_provider_check;

alter table public.app_settings
  add constraint app_settings_scoring_provider_check
    check (scoring_provider in ('claude', 'openai', 'gemini'));
