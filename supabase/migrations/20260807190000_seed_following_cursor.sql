-- The Apify following actor delivers ~1,000 results per free account per day and
-- returns a continuation token (valid ~7 days) for the remainder. Without
-- storing that token between runs, the next day's crawl restarts from the top
-- and spends its entire allowance re-delivering accounts already in the
-- database — quota is charged on what the actor delivers, so de-duplicating on
-- our side recovers nothing. Persisting it lets a large account be walked
-- across several days instead of never finishing.

alter table public.seeds
  add column if not exists following_cursor text,
  add column if not exists following_cursor_expires_at timestamptz;
