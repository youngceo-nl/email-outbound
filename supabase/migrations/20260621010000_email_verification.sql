alter table public.app_settings
  add column if not exists neverbounce_api_key text default null,
  add column if not exists zerobounce_api_key text default null;
