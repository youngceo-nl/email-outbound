-- Model used for report generation, kept separate from the scoring model.
--
-- Scoring runs thousands of times a day and uses a cheap model deliberately.
-- Reports run a handful of times a day and do open-ended analysis, which is
-- exactly where a small model produces confident generalities instead of
-- findings — so it gets its own setting rather than sharing openai_model.
--
-- Default is claude-sonnet-5. The report's value is entirely in the quality of the
-- reasoning behind it, which is the one thing worth paying for here — a report costs
-- cents either way, and a weak one costs a prospect.
--
-- lib/report/ai/client.ts infers the provider from this string: anything starting
-- with "claude" goes to the Anthropic API, anything else to OpenAI. So switching
-- providers is this one value (gpt-5.6-terra for the OpenAI equivalent, gpt-5.6-sol
-- for its premium tier) — no code change, no second setting to keep in sync.
--
-- If the ID is rejected, or that provider has no key configured, the client falls
-- back to claude_model and then openai_model, so a bad value degrades the prose
-- rather than breaking report generation.
alter table public.app_settings
  add column if not exists report_model text not null default 'claude-sonnet-5';

-- House strategy brief, appended to the report analysis prompt.
--
-- The prompt encodes a strategist's judgement, and most of that judgement is
-- Conversion Brands' own — which prospects are a poor fit, what the standard
-- deliverable is, claims that must never be made. Hardcoding it would mean every
-- refinement needs a developer; this makes it editable in Settings so the people
-- with the opinions can tune them directly.
alter table public.app_settings
  add column if not exists report_strategy_notes text;
