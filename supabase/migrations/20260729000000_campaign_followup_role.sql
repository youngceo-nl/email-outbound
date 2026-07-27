-- Cold/warm follow-up chains (docs/instantly-fying-outreachpage/leadpipelinetocampaign.md).
-- A campaign can now be tagged as the automatic follow-up chain for its
-- campaign_type track, instead of a regular human-run ("primary") campaign.
-- The new auto-routing/auto-send Inngest jobs only ever touch campaigns with
-- campaign_role <> 'primary' — primary campaigns keep today's fully-manual
-- assign/send flow completely unchanged.
alter table public.campaigns
  add column if not exists campaign_role text not null default 'primary'
    check (campaign_role in ('primary', 'cold_followup', 'warm_followup'));

-- At most one live cold-followup and one live warm-followup chain per lead
-- track (infopreneur/partnership) — otherwise auto-routing wouldn't know
-- which chain to drop a newly-cooled/newly-warmed lead into. Soft-deleting a
-- chain frees its slot immediately for a replacement.
create unique index if not exists campaigns_one_followup_per_type_idx
  on public.campaigns (campaign_type, campaign_role)
  where campaign_role <> 'primary' and deleted_at is null;

-- Disambiguates a background auto-send from a human click in campaign send
-- history — outreach_messages.sent_by is already nullable, but that alone
-- can't tell "no user because automated" apart from "no user because the
-- account was deleted".
alter table public.outreach_messages
  add column if not exists sent_via text not null default 'manual'
    check (sent_via in ('manual', 'auto'));
