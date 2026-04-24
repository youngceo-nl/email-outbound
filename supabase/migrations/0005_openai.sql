-- Add OpenAI as a scoring provider option. Default to OpenAI.
alter table public.app_settings
  add column if not exists openai_api_key text,
  add column if not exists openai_model text not null default 'gpt-4o-mini',
  add column if not exists scoring_provider text not null default 'openai'
    check (scoring_provider in ('claude', 'openai'));
