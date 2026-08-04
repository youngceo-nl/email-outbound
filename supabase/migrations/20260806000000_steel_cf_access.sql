-- The self-hosted Steel server sits behind Cloudflare Access, which is a
-- browser-SSO layer: it rejects the pipeline with 403 no matter what Steel's
-- own API key says. Service tokens are Cloudflare's machine-to-machine path —
-- two headers, CF-Access-Client-Id and CF-Access-Client-Secret, sent on every
-- request.
--
-- This matters more than it looks: self-hosted Steel has no authentication of
-- its own (the client passes a placeholder key and the container accepts it),
-- so Cloudflare Access is the only thing keeping the browser backend off the
-- open internet. The token is the way through it, not a way around it.
--
-- Both null (the default) means no Cloudflare headers are sent, so a local or
-- unprotected instance keeps working unchanged.

alter table public.app_settings
  add column if not exists steel_cf_client_id text,
  add column if not exists steel_cf_client_secret text;
