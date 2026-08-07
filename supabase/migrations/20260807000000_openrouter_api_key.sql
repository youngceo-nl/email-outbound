-- OpenRouter graduates from a personal benchmark key (lib/qualification/
-- providers.ts's "openrouter" LlmProvider, added to compare extraction
-- models) into the production extractor's actual provider
-- (inngest/functions/qualify-lead.ts) once gemini-2.5-flash was validated
-- against Haiku 4.5. Every other provider key already sits on app_settings;
-- this closes the gap so the key isn't stuck on one laptop's .env.local.

alter table public.app_settings
  add column if not exists openrouter_api_key text;
