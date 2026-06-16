-- Allow crawl_jobs to exist without a seed (e.g. bulk-analyze from CSV import).
alter table public.crawl_jobs
  alter column seed_id drop not null;
