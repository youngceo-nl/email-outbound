-- Credentials for auto-refreshing the YouTube/Google session cookie.
-- When yt_google_cookie goes stale, the enrichment pipeline logs back in with
-- these to mint a fresh one (see lib/youtube/refresh-cookie.ts).
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS yt_google_email       text,
  ADD COLUMN IF NOT EXISTS yt_google_password    text,
  ADD COLUMN IF NOT EXISTS yt_google_totp_secret text;
