# Ideas

## [ ] Instagram Burner Cookie Strategy (minimizing suspension risk)

### Why accounts get suspended
Instagram bans based on behavioral patterns, not just volume:
- Too many API calls through one session in a short window
- Calls coming from a server IP (not residential)
- No natural pauses between requests (inhuman cadence)
- Repeatedly fetching the same accounts
- New accounts with zero organic activity

### Volume math
A typical scrape of 1 source account at 1000 profiles = ~20 batch API calls (50 accounts per page).
10 source accounts = ~200 calls per full run.
At 1 cookie: 200 calls through one session → high detection risk.
At 5 cookies: ~40 calls each per run → much safer.
At 10 cookies: ~20 calls each per run → very safe for daily runs.

### Recommended pool size by usage

| Sources scraping daily | Min cookies | Comfortable | Ideal |
|---|---|---|---|
| 1–3 sources | 2 | 3 | 5 |
| 4–10 sources | 3 | 5 | 8 |
| 10+ sources | 5 | 10 | 15+ |

**Current setup:** we have 1 seed (joshsklein active) — 3 cookies is the minimum to start safely.

### Account quality matters more than quantity
- **New accounts** (<30 days old): higher ban rate, shorter cookie TTL (~7–14 days), more CAPTCHAs
- **Aged accounts** (6+ months, some posts/follows): treated like real users, cookies last weeks, far lower ban rate
- **Ratio:** better to have 3 aged accounts than 10 fresh ones

### Practical rules
1. ✅ Never scrape the same source twice within 2 hours on the same cookie — 2h rate-limit TTL is implemented
2. ❌ Don't run all seeds simultaneously — daily scrape fires all 4 seeds at once, stagger of 10–15 min not yet implemented
3. ❌ Add a small random delay (1–3s) between paginated batch calls — not implemented
4. ❌ If an account gets a 401/403 (not just 429), retire that cookie immediately — not automated
5. Each burner account should follow ~20–50 real accounts and have a profile pic to look human (operational, not code)

### Phase plan
- **Now (testing):** 2–3 fresh accounts, expect occasional 429s, monitor for 401s
- **Month 1:** Replace with 3–5 aged accounts (buy or grow organically)
- **Long term:** 5–10 aged accounts, run on a remote server with residential proxies per cookie

---

## [ ] Platform-Based Seed Discovery (Pre-Qualified Lead Sources)

**Context:** Instead of scraping hashtags and filtering down, these platforms are pre-qualified seed lists — everyone listed already has a paid offer, which is the #1 ICP qualifier.

### Sub-niches in the info product space

**Business/Online Income**
- Dropshipping / e-com
- Amazon FBA / wholesale
- Print on demand
- Digital products (Notion templates, presets, ebooks)
- Etsy / handmade business
- YouTube monetization / faceless YouTube
- TikTok shop / UGC creator education
- Blogging / SEO / affiliate marketing
- Newsletter / Substack building
- Course creation (teaching how to make courses)

**Service Business / Freelancing**
- SMMA
- Copywriting
- Video editing
- Graphic design / branding
- Web design / development
- Pinterest/SEO virtual assistant
- Bookkeeping / accounting freelance
- AI automation agency
- Cold email outreach agency

**Finance / Investing**
- Forex trading
- Crypto / Web3
- Stock options trading
- Real estate (wholesaling, flipping, rentals, creative finance)
- Credit repair / building
- Personal finance / budgeting

**Creative / Media**
- Music production / beatmaking
- Artist development / label deals
- Podcast monetization
- Photography / videography business
- Ghostwriting
- UGC content creation

**Personal Development (with an offer)**
- Productivity systems / ADHD coaching
- Confidence / charisma for men
- Feminine energy / dating for women
- Spirituality + business (law of attraction + income)
- Parenting + income (mompreneur space)

**Highest-signal sub-niches** (operators most likely running sales calls + webinars): SMMA, AI agency, course creation, Amazon FBA, real estate, credit repair.

---

### Platforms where these operators are listed

**Course/Product Marketplaces**
- **Skool** — skool.com/communities, browse public communities by category. Community owner profile usually links Instagram.
- **Whop** — browse by category (business, trading, ecom). Each seller page has socials.
- **Kajabi** — creator directory
- **Gumroad Discover** — browse by category
- **ClickBank Marketplace** — affiliate marketplace. Every product has an operator behind it. Click "affiliate page" or google the vendor name + Instagram.
- **Digistore24** / **JVZoo** — similar to ClickBank

**Leaderboards / Curated Lists**
- **Skool Games** — Alex Hormozi's challenge, public leaderboard of operators competing by revenue. Everyone on it is active and monetized.

**Influencer Directories**
- **Influence.co** — influencer directory with niche filters
- **Creator.co** / **AspireIQ** — similar

---

### Workflow to turn a platform into seeds

1. Browse the platform (e.g. Skool communities, Whop marketplace, ClickBank marketplace)
2. Get the operator's name / brand name from their listing
3. Find their Instagram handle — linked on their sales page, Skool profile, or google `"[name]" instagram`
4. Feed the handle into the scraper as a seed
5. Run through the normal scrape → backfill → score pipeline

**Leverage multiplier:** Once you have one operator's handle, scrape their **following list** — info product operators follow each other heavily. One Skool community owner's following list is likely 80%+ ICP.

---

### Skool Discovery — Scoring criteria from the CSV

We scraped the Skool discovery page and got ~500+ communities. Here's how to read the signals:

**Price signal:**
- **Free** = almost always top-of-funnel for a high-ticket backend. These are the most valuable because the operator needs calls booked. Look for free communities with 5k–100k members in a business/income niche.
- **$47–$200/mo** = operator is actively monetizing a recurring community — likely has a bigger offer (mastermind, 1:1, course). High signal.
- **$9–$25/mo** = low-ticket info product, probably not a sales-call operator. Lower priority.

**Member count:**
- 1k–50k is the sweet spot. Under 500 = just starting. Over 100k = likely a media brand, not a sales-call operator.

**Description keywords that score high:** "get your first client", "scale to $X", "sales calls", "high-ticket", "agency", "coaching program", "mastermind", "income", "revenue"

**Description keywords that score low:** "beginner-friendly", "passive income", "no experience needed", "faceless YouTube", "peptides", "spirituality"

---

### Top Skool communities to investigate (from June 2026 scrape)

These are the highest-ICP matches from the discovery page CSV. Next step for each: visit the community, find the owner's name, google `"[name]" instagram`, add handle as a seed.

| Community | URL slug | Price | Members | Why it's ICP |
|---|---|---|---|---|
| Wholesaling Real Estate | wholesaling | Free | 77k | Real estate, free = high-ticket backend |
| Agency Owners | agencyowners | Free | 20k | Agency operators who sell via calls |
| Synthesizer: Free Skool Growth | synthesizer | Free | 44k | Educators making $10k–$100k/mo |
| Wholesale Vacant Land | wienerbros | Free | 18k | Real estate, free top-of-funnel |
| High Ticket Sales Training | high-ticket-sales-training | Free | 4.1k | "High ticket" is literally in the name |
| Agency Coach Community | agencycoach | Free | 4.4k | Agency coaching operators |
| Closers Inner Circle | closers-circle | Free | 3k | Elite high-ticket sales placements |
| AI Automation Society Plus | ai-automation-society-plus | $99/mo | 3.8k | Paid tier of 410k free community |
| Agentic AI for Founders | agentic-ai-for-founders | $97/mo | 3.8k | AI agency operators |
| Maker School: AI Automation | makerschool | $184/mo | 2k | "Get your first AI client in 90 days" |
| School of Mentors | schoolofmentors | $49/mo | 6.1k | Mentored by millionaires/billionaires |
| Facebook Ads Mastery | facebookads | $147/mo | 551 | $250M managed, 1,500+ clients |
| Origins Ecommerce | origins | $98/mo | 1.3k | $100k/mo Shopify + Facebook ads |
| Email Marketing Mastery | email-marketerz | $247/mo | 265 | $200M+ in ecom revenue, high-ticket signal |
| SCALE - AI for DTC & Agencies | scale-ai | $97/mo | 660 | DTC brands + agencies |
| The Ecom Wolf Den | the-ecom-wolf | $99/mo | 981 | "0–100k/mo" store building |
| Gym Exit | gymexit | $197/mo | 111 | Online fitness biz scale + sales calls |
| Copy Systems | copysystems | $999/mo | 415 | Copywriters charging $10k–$70k/mo |
| Setterlun University | setterlun-university | $17/mo | 4.4k | "Agency Owners, Coaches & Online Experts Scale to $25M+" |
| Wealthy Plumber | wealthyplumber | $99/mo | 815 | Blue collar business training |

**Next step:** For each row, visit `skool.com/[slug]/about`, click the owner's profile, check for Instagram link. If not there, google `"[owner name]" instagram`.

**CSV on file:** The full ~500-community CSV from the June 2026 Skool discovery page scrape is saved locally. If we want to automate scoring, we can write a script that parses it, scores each row by price + keywords, and outputs a ranked list.

---

## [ ] Automated Seed Discovery

> **Partially implemented differently:** "Discover from Google" via Serper exists on the seeds page, but it's manual — the user triggers it. The idea here was fully automatic: search, filter, and auto-add seeds with no human click. That part is not done.

**Concept:** Info operators are the best seed accounts (e.g. @joshsklein, @pierree) because they follow other info operators — which is exactly the ICP. Instead of manually adding seeds, automate finding them.

**How it would work:**
1. Use Serper to search Instagram for accounts with bio keywords like "info operator", "course creator", "online business", "coaching program"
2. Filter by follower count (above a threshold)
3. Auto-add qualifying accounts as seeds
4. They run through the normal scrape → backfill → score pipeline

**Why it works:** An info operator's following list is a goldmine of ICP leads.

---

## [x] Manual Lead Input

> **Implemented:** "Add lead" button on the leads page — enter a username or URL, optionally scrape & score immediately. Activity drawer shows progress.

**Concept:** When you come across an account organically (e.g. someone you see in comments, a DM, a recommendation), manually submit their username and let the app check if they're ICP.

---

## [x] Seed Discovery from Existing Datapool

> **Implemented differently:** Live in the "Suggested seed accounts" panel on the seeds page — shows top qualified leads grouped by niche (top 2 per niche, 15 total), with a one-click "Add as seed" button. There's no button on the individual lead profile page, but the seeds page panel covers the use case.

**Concept:** Instead of always finding seeds externally, use the leads already in the database. Qualified leads who themselves follow a lot of info operators are good seed accounts — they're already vetted ICP and their following list is likely full of similar profiles.

---

## [x] Churn Bucket (No Email Found, ICP Qualified)

> **Implemented:** `/churn` page — qualified leads with no email after enrichment, sorted by score. Retry email, dismiss, or look them up manually.

---

## [x] Scrape visibility

> **Implemented differently:** Active Searches card on the dashboard shows per-job progress (scraped, qualified, % done). The activity tab shows every pipeline action (scraped, filtered, scored, email found/not found) in real time. The original idea asked for a single-line summary per scrape — the dashboard card is more granular than that.

Being able to see what the scrape is doing (e.g. 148 accounts found, 140 duplicates, 8 new accounts added to the database).

---

## [ ] Efficient & Cheap Lead Analysis

**Context:** The LLM is already only used for classification (niche, business model, offer type) — all numeric scores are computed locally for free. The bottleneck is how many leads unnecessarily reach the LLM.

### Levers (cheapest first):

**1. [x] Tight `include_keywords` (free, biggest impact)**
Already configurable in settings — no code needed. Keeping keywords like "coach, course, info operator, online business" tight cuts LLM spend at zero engineering cost.

**2. [x] Metric fast-reject before LLM (free)**
`metricsGate` already runs before `scoreProfileRouted` in `process-profile.ts` — dead accounts are rejected without an LLM call.

**3. [ ] Bio hash caching (near-free)**
Many accounts copy-paste the same bio template. Store a `sha256(bio)` → classification result in a DB table. Cache hit = zero LLM cost. Cache miss = normal LLM call + store result.

**4. [ ] OpenAI Batch API (50% cheaper)**
Queue classification calls and submit them via OpenAI's Batch API instead of per-lead real-time calls. Results come back async (up to 24h), but for background enrichment this is fine. Halves LLM cost with no quality change.

**5. [ ] Two-tier model routing**
Use haiku/gpt-4o-mini for obviously borderline cases and a stronger model only when the bio is rich/ambiguous. Simple heuristic: bio length < 50 chars → mini model; longer/more complex → normal model.

---

## [ ] Email finder waterfall

> **Partially implemented:** Hunter.io is already integrated as an email finder. The waterfall approach (try multiple providers in sequence) is not implemented — Hunter is the only one wired up.

Clay's email finder waterfall (work email, based on domain + full name):
Findymail, Hunter, Prospeo, Kitt, Datagma, Wiza, Icypeas, Enrow, Leadmagic

For personal email:
rb2b.com, Mixrank, RocketReach, Data Labs, Aviato, ContactOut, Limadata, Forager

GetProspect API: https://getprospect.readme.io/reference/publicapiemailcontroller_publicfindemail

Check if these tools are cheaper than Clay's per-email rate before integrating.

---

## [ ] Unified account-based cookie management (Instagram + YouTube)

Both Instagram and YouTube cookie management should follow the same pattern:

- User enters account credentials (email/username + password, optionally TOTP secret) for one or more accounts
- The system logs in automatically, catches the resulting cookie, and displays it in the corresponding cookie box — so the user can always see which cookie is active for each account
- If a cookie expires or gets invalidated, it is refreshed automatically in the background without manual intervention
- A manual cookie option stays available as a fallback (paste a raw cookie directly)

This applies to both Instagram burner accounts and YouTube/Google accounts.

---

## [ ] YouTube Google Account Strategy (for cookie-based email reveal)

**Context:** The headless Chromium + CapSolver flow needs a logged-in Google/YouTube session cookie. The quality of that account affects how long the cookie stays valid and whether YouTube flags the scraping activity.

### New account vs aged profile

**New account (fresh Gmail)**
- Free to create, no risk to existing identity
- YouTube may require phone verification or show more CAPTCHAs for new accounts
- Higher chance of getting flagged/suspended faster because no watch history, subscriptions, or normal usage patterns
- Cookie TTL may be shorter (Google refreshes sessions more aggressively for inactive accounts)
- Good for initial testing — low stakes if it gets banned

**Aged profile (older Gmail with activity)**
- Google trusts older accounts with established activity more
- Fewer CAPTCHAs, more stable cookies, longer session TTL
- Much harder to get flagged for occasional scraping if the account looks like a real user
- Can buy aged accounts (~$5–20) or use a personal secondary Gmail
- Long-term this is the better option

**Goal:** Run remotely (server/worker) without needing the laptop on, with a stable long-lived cookie.

---

## [x] IP Rotator for Instagram scraping

> **Implemented:** Reactive 429 fallback is live in `direct.ts` — when Instagram rate-limits a sessionless request, it retries through the configured proxy. Playwright scraper also supports `proxyUrl`. Per-account proxy URLs are configurable in the cookie pool. The "what's missing" list from when this was written is now done.
