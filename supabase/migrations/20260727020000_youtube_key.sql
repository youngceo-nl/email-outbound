-- YouTube Data API v3 key, for report generation.
--
-- Creators put their entire offer stack in video descriptions — program names,
-- prices, payment plans. Report generation reads the channel a lead links in
-- their bio (never a name-search guess: attaching the wrong person's channel to
-- a report that greets them by name is worse than no channel at all) and feeds
-- subscriber reach into the audience picture and description prices into the
-- offer ladder. Falls back to the YOUTUBE_API_KEY env var when blank.
alter table public.app_settings
  add column if not exists youtube_api_key text;
