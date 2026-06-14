-- Add proxy provider credentials and cookie pool to app_settings
alter table public.app_settings
  add column if not exists instagram_cookies    text,
  add column if not exists proxy_provider       text not null default 'iproyal',
  add column if not exists iproyal_user         text,
  add column if not exists iproyal_pass         text,
  add column if not exists nineproxy_user       text,
  add column if not exists nineproxy_pass       text,
  add column if not exists dataimpulse_user     text,
  add column if not exists dataimpulse_pass     text;
