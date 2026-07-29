// Shared TypeScript types — kept thin and aligned with the SQL schema.

export type EmailKeyStatus = {
  status: "ok" | "exhausted" | "invalid" | "rate_limited";
  credits?: number | null;
  checkedAt: string; // ISO
};

export type LeadStatus = "qualified" | "review" | "rejected" | "pending";

/**
 * Where a lead's offer is hosted, as classified by lib/funnel/classify.ts.
 *
 * This type went missing from here while the funnel enricher sat in archive/,
 * which is why that code no longer compiled. Aggregators (link-in-bio pages) are
 * distinguished because the enricher drills through them to the real offer page
 * rather than reading a list of links.
 */
export type FunnelPlatform =
  | "linktree"
  | "stan"
  | "beacons"
  | "skool"
  | "whop"
  | "circle"
  | "gumroad"
  | "clickfunnels"
  | "kajabi"
  | "systeme"
  | "gohighlevel"
  | "shopify"
  | "thrivecart"
  | "podia"
  | "teachable"
  | "thinkific"
  | "wix"
  | "wordpress"
  | "squarespace"
  | "custom"
  | "unknown";

// A cookie account managed by the system: credentials are stored so the auto-
// refresh cron can re-login without user input. Passwords never leave the server.
export type CheckpointState = {
  cookies: string;   // cookie header to reuse for code submission
  csrf: string;
  challenge_url: string; // full URL to POST the security code to
  email_hint: string | null; // masked email shown by Instagram, e.g. "n****@gmail.com"
};

export type ManagedAccount = {
  id: string;
  label: string;          // Instagram username OR Google email — display + login identifier
  password: string;       // server-only: stored for automated re-login
  totp_secret: string | null; // server-only
  account_email: string | null; // email address associated with the account, shown during checkpoint
  cookie: string | null;
  cookie_set_at: string | null; // ISO timestamp of last successful login
  last_error: string | null;
  checkpoint_state: CheckpointState | null;
  proxy_url: string | null; // dedicated residential proxy for this account, e.g. http://user:pass@host:port
  group?: string | null;  // rotation group label, e.g. "A", "B" — only the active group is scraped
  paused?: boolean;       // true = excluded from scraping (cooling off), account is kept in DB
};

// Sent to client components — includes credentials since this is a self-hosted tool.
export type ManagedAccountDisplay = ManagedAccount;
export type ActivityStatus = "very_active" | "active" | "semi_active" | "inactive";
export type CrawlJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type RecentPost = {
  caption: string | null;
  likes: number | null;
  comments: number | null;
  views: number | null;
  taken_at: string | null;
  is_reel?: boolean;
  is_pinned?: boolean;
};

export type AppSettings = {
  id: 1;
  apify_api_key: string | null;
  apify_api_keys: string[];
  claude_api_key: string | null;
  claude_model: string;
  scrapingbee_api_key: string | null;
  default_seeds: string[];
  max_profiles_per_account: number;
  crawl_score_threshold: number;
  min_followers: number;
  max_followers: number;
  min_engagement_rate: number;
  min_reels_last_30_days: number;
  include_keywords: string[];
  exclude_keywords: string[];
  following_scraper_provider: "playwright" | "apify" | "scrapingbee" | "cookie" | "auto" | "colddms";
  instagram_session_cookie: string | null;
  // ColdDMS (app.colddms.com) login for the "Auto IG Scraper" provider —
  // see lib/instagram/colddms-scraper.ts.
  colddms_email: string | null;
  colddms_password: string | null;
  instagram_session_cookies: string[];
  scoring_provider: "openai" | "claude" | "gemini" | "groq";
  openai_api_key: string | null;
  /** YouTube Data API v3 — report collection. Migration 20260727020000_youtube_key.sql. */
  youtube_api_key: string | null;
  openai_model: string;
  /** Report generation only — see migration 20260727000000_report_model.sql. */
  report_model: string;
  /** House strategy brief appended to the report analysis prompt. Editable in Settings. */
  report_strategy_notes: string | null;
  gemini_api_key: string | null;
  gemini_model: string;
  groq_api_key: string | null;
  groq_model: string;
  capsolver_api_key: string | null;
  scrapingbee_api_keys: string[];
  instagram_proxy_url: string | null;
  instagram_groups: string[];           // ordered list of group names; groups can exist with no accounts
  active_account_group: string | null; // which group is currently active for scraping; null = use all
  instagram_proxy_pool: string[];      // shared IP pool — assigned by slot position to accounts in active group
  ig_cookie_status: "live" | "dead" | null;
  // Multi-account managed cookies (credentials stored for auto-refresh)
  instagram_accounts: ManagedAccount[];
  backfill_cancel_requested: boolean;
  backfill_started_at: string | null;
  updated_at: string;
  // Per-key status cache: key is "provider:last12chars", value is last check result
  email_key_statuses: Record<string, EmailKeyStatus>;
  // Outreach — templates rendered per lead by lib/outreach/template.ts
  outreach_subject_template: string;
  outreach_body_template: string;
  // Per-category copy (lib/leads/category.ts) — one pair per outreach tab.
  outreach_subject_partnerships: string;
  outreach_body_partnerships: string;
  outreach_subject_info: string;
  outreach_body_info: string;
  outreach_subject_other: string;
  outreach_body_other: string;
  outreach_reply_to: string | null;
  // Gmail send path. gmail_from_name is the display name on outgoing mail.
  gmail_from_name: string | null;
  gmail_oauth_client_id: string | null;
  gmail_oauth_client_secret: string | null;
  gmail_oauth_refresh_token: string | null;
  gmail_oauth_email: string | null;
};

export type Seed = {
  id: string;
  username: string;
  profile_url: string;
  notes: string | null;
  exhausted_providers: string[];
  created_at: string;
  /** How many accounts this seed follows — the ceiling a full-account scrape will hit. Null until checked. */
  following_count: number | null;
};

export type Lead = {
  id: string;
  username: string;
  full_name: string | null;
  profile_url: string;
  /** Instagram CDN URL, captured at scrape time. The URL is signed and expires,
   *  so the bytes are fetched fresh when a report is generated rather than trusted
   *  to still resolve later. */
  profile_pic_url: string | null;
  bio: string | null;
  external_link: string | null;
  is_private: boolean;
  is_verified: boolean;
  followers: number | null;
  following: number | null;
  posts: number | null;
  avg_likes: number | null;
  avg_comments: number | null;
  avg_views: number | null;
  engagement_rate: number | null;
  posts_last_30_days: number | null;
  reels_last_30_days: number | null;
  activity_status: ActivityStatus | null;
  recent_posts: RecentPost[];
  niche: string | null;
  business_model: string | null;
  offer_type: string | null;
  audience_type: string | null;
  icp_fit_score: number | null;
  traction_score: number | null;
  monetization_score: number | null;
  activity_score: number | null;
  overall_score: number | null;
  reason_for_score: string | null;
  recommended_action: string | null;
  status: LeadStatus;
  rejection_reason: string | null;
  // Which qualification rubric this lead was scored against (lib/leads/category.ts
  // leadTrackFor) — also the vocabulary campaigns.campaign_type reuses.
  lead_type: "infopreneur" | "partnership";
  crawl_depth: number;
  source_seed_id: string | null;
  parent_username: string | null;
  lead_source: string | null;
  backfill_error: string | null;
  // Email discovery. `email` is the v1 waterfall result; `email_v2` is a
  // parallel experiment column that was never rolled out (2 rows populated).
  email: string | null;
  email_status: string | null;
  email_provider: string | null;
  email_v2: string | null;
  email_v2_status: string | null;
  email_v2_provider: string | null;
  // `enriched_at` is stamped only when the Clay hand-back round-trip actually
  // returned an email; `handover_enriched_at` is stamped either way, so it's
  // the true "was this lead sent through enrichment at all" signal
  // (lib/handover/batch.ts). A lead can have an email with both null — found
  // by the original scrape-time waterfall before ever reaching Clay.
  enriched_at: string | null;
  handover_enriched_at: string | null;
  // Funnel enrichment — funnel_program_name feeds {{program_name}} in the
  // outreach subject line, so junk values are visible to the prospect.
  //
  // All seven columns come from migration 0008_funnel_enrichment.sql; only the
  // first two were ever declared here because only they had a consumer. The rest
  // are read by app/api/leads/export/route.ts and now by the report generator,
  // which is what surfaced the drift.
  funnel_program_name: string | null;
  funnel_offer_summary: string | null;
  funnel_url: string | null;
  /** "skool", "kajabi", "linktree", … as classified by the funnel enricher. */
  funnel_platform: string | null;
  /** Free text as it appeared on the page — see lib/report/assumptions/price.ts. */
  funnel_price: string | null;
  /**
   * Every price seen across the funnel scrape, as captured — the report's offer
   * ladder is built from this (lib/report/ladder.ts). Migration
   * 20260727010000_funnel_prices.sql; null for leads enriched before it.
   */
  funnel_prices: Array<{ raw: string; label: string | null; url: string | null; source: string }> | null;
  funnel_extracted_at: string | null;
  funnel_extraction_error: string | null;
  // Outreach counters, maintained application-side (no DB trigger).
  outreach_count: number;
  last_outreach_at: string | null;
  last_outreach_error: string | null;
  // Campaign assignment (optional, layered on top of the category system).
  // campaign_step counts steps already sent — the next due step is +1.
  // campaign_variant_id is rolled once at assignment (weighted by the
  // campaign's variants) and never changes while the lead stays assigned.
  campaign_id: string | null;
  campaign_variant_id: string | null;
  campaign_step: number;
  last_campaign_send_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CampaignStatus = "active" | "paused" | "archived";
export type CampaignType = "infopreneur" | "partnership";
// "primary" = a regular, human-run campaign (default). "cold_followup" /
// "warm_followup" mark the (at most one each, per campaign_type) chain that
// the route-followup-leads Inngest job auto-assigns leads into — see
// docs/instantly-fying-outreachpage/leadpipelinetocampaign.md.
export type CampaignRole = "primary" | "cold_followup" | "warm_followup";

export type Campaign = {
  id: string;
  name: string;
  angle: string | null;
  status: CampaignStatus;
  // Which leads this campaign may be assigned (must match leads.lead_type) —
  // enforced in app/actions/campaigns.ts assignLeadsToCampaign.
  campaign_type: CampaignType;
  campaign_role: CampaignRole;
  // Canned reply shown to the VA in the inbox when a reply on this campaign
  // is classified 'positive' (lib/openai/classify-reply.ts) — rendered via
  // the same buildLeadContext/renderTemplate as outreach templates.
  positive_reply_template: string | null;
  // Soft-delete marker — set by deleteCampaign, cleared by restoreCampaign.
  // Kept for CAMPAIGN_RETENTION_DAYS (lib/campaigns/retention.ts) before the
  // purge-deleted-campaigns cron removes the row for real.
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CampaignVariant = {
  id: string;
  campaign_id: string;
  label: string;
  // A lead is rolled into one variant (weighted by this) at assignment time
  // and stays on it for the whole campaign — not re-rolled per step.
  weight_pct: number;
};

export type CampaignStep = {
  id: string;
  variant_id: string;
  step_number: number;
  delay_days: number;
  subject_template: string;
  body_template: string;
};

export type OutreachMessage = {
  id: string;
  lead_id: string;
  to_email: string;
  subject: string;
  body_text: string | null;
  body_html: string | null;
  status: "sent" | "failed" | "bounced";
  message_id: string | null;
  gmail_thread_id: string | null;
  error: string | null;
  sent_by: string | null;
  sent_via: "manual" | "auto";
  sent_at: string;
  bounced_at: string | null;
  email_type: "outreach" | "followup";
  campaign_id: string | null;
  campaign_variant_id: string | null;
  step_number: number | null;
};

// Raw scraped profile shape (post-normalization, pre-scoring)
export type ScrapedProfile = {
  username: string;
  full_name: string | null;
  profile_url: string;
  /** Instagram CDN URL. Signed and short-lived — see lib/report/renderer/prospect-image.ts. */
  profile_pic_url: string | null;
  bio: string | null;
  external_link: string | null;
  followers: number;
  following: number;
  posts: number;
  is_private: boolean;
  is_verified: boolean;
  recent_posts: RecentPost[];
};

// Claude scoring output — strict JSON contract
export type ClaudeScore = {
  icp_fit_score: number;
  traction_score: number;
  monetization_score: number;
  activity_score: number;
  overall_score: number;
  niche: string;
  business_model: string;
  offer_type: string;
  audience_type: string;
  reason_for_score: string;
  recommended_action: "qualified" | "review" | "reject";
};

export type CrawlJob = {
  id: string;
  seed_id: string;
  status: CrawlJobStatus;
  max_depth: number;
  current_depth: number;
  profiles_scraped: number;
  new_leads: number;
  qualified_count: number;
  rejected_count: number;
  expected_profiles: number | null;
  inngest_run_id: string | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};
