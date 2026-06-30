-- Track where a lead was sourced from (e.g. "Skool", "Whop", "ClickBank", "IG crawl")
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_source TEXT;
