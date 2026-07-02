-- Add Groq as a free scoring provider option (real free tier, not region-restricted).
alter table public.app_settings
  add column if not exists groq_api_key text,
  add column if not exists groq_model text not null default 'llama-3.3-70b-versatile';

alter table public.app_settings
  drop constraint if exists app_settings_scoring_provider_check;

alter table public.app_settings
  add constraint app_settings_scoring_provider_check
    check (scoring_provider in ('claude', 'openai', 'gemini', 'groq'));
