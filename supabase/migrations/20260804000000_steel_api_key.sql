-- Steel was the last credential with no shared home: browser-backend.ts read it
-- from STEEL_API_KEY only, so the key lived on one laptop and teammates ran a
-- pipeline whose every acquisition threw. Every other provider key already sits
-- on app_settings; this closes the gap.
--
-- Readers prefer this column and fall back to the env var, so the CLI harness
-- (which has no settings row) keeps working unchanged.

alter table public.app_settings
  add column if not exists steel_api_key text;
