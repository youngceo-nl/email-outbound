-- Managed cookie accounts: each row stores credentials + the auto-minted cookie.
-- Passwords are stored so the auto-refresh cron can re-login without user input.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS instagram_accounts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS yt_accounts        jsonb NOT NULL DEFAULT '[]'::jsonb;
