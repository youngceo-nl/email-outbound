-- Model used for report generation, kept separate from the scoring model.
--
-- Scoring runs thousands of times a day and uses a cheap model deliberately.
-- Reports run a handful of times a day and do open-ended analysis, which is
-- exactly where a small model produces confident generalities instead of
-- findings — so it gets its own setting rather than sharing openai_model.
--
-- Default is gpt-5.6-terra: the same organisation's report-generator repo
-- verified that ID against the live OpenAI catalog on 2026-07-14 and chose it
-- specifically for report generation (gpt-5.6-luna for extraction,
-- gpt-5.6-sol for premium review). If deeper analysis is wanted later,
-- gpt-5.6-sol is the upgrade — change this one value, no code change.
--
-- If the ID is ever rejected by the API, lib/report/ai/client.ts falls back to
-- openai_model so a bad value degrades the prose rather than breaking reports.
alter table public.app_settings
  add column if not exists report_model text not null default 'gpt-5.6-terra';

-- House strategy brief, appended to the report analysis prompt.
--
-- The prompt encodes a strategist's judgement, and most of that judgement is
-- Conversion Brands' own — which prospects are a poor fit, what the standard
-- deliverable is, claims that must never be made. Hardcoding it would mean every
-- refinement needs a developer; this makes it editable in Settings so the people
-- with the opinions can tune them directly.
alter table public.app_settings
  add column if not exists report_strategy_notes text;
