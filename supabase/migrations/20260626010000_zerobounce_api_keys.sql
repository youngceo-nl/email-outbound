alter table app_settings
  add column if not exists zerobounce_api_keys text[] not null default '{}';
