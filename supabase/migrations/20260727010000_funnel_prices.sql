-- Every price found on a lead's funnel properties, not just the first.
--
-- funnel_price (singular, text) captured one number, and the report modelled
-- whatever it happened to be — which is how a $12/mo app subscription became the
-- sole input to a launch P&L while the real program on the same page went unread.
--
-- This column stores the full capture as a JSON array of
--   { raw, label, url, source }
-- (price string as written, tier/program label if the page showed one, page URL,
-- and which extraction step saw it). Parsing, rung classification and routing
-- happen in code at report time — lib/report/ladder.ts — so a classification
-- change never requires re-scraping.
--
-- funnel_price stays: it remains the "main offer" price for outreach templates,
-- and the ladder falls back to it for leads enriched before this column existed.
alter table public.leads
  add column if not exists funnel_prices jsonb;
