-- Steel can now run self-hosted (docker run ghcr.io/steel-dev/steel-browser-api,
-- Apache 2.0) instead of api.steel.dev. steel_base_url points the client at it;
-- left null, everything reads unchanged from Steel Cloud.

alter table public.app_settings
  add column if not exists steel_base_url text;
