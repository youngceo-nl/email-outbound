alter table app_settings
  add column if not exists apollo_api_key text;
