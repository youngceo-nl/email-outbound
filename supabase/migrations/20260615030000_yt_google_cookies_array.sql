ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS yt_google_cookies text[] NOT NULL DEFAULT '{}';

-- Migrate existing single cookie into the array if not already done.
UPDATE app_settings
SET yt_google_cookies = ARRAY[yt_google_cookie]
WHERE yt_google_cookie IS NOT NULL
  AND yt_google_cookie <> ''
  AND array_length(yt_google_cookies, 1) IS NULL;
