# Email Enrichment — Improvement Backlog

_Audited: 2026-06-24_

Pipeline order: bio → YouTube → LinkedIn → domain waterfall → domain inference

---

## Issues found (priority order)

### 1. YouTube gated cookie is broken
- **Impact**: was responsible for 10 confirmed email hits (largest single source after bio)
- **Status**: `YT_GOOGLE_COOKIE` env var is set but expired — traces show "not signed in"
- **Fix**: refresh the YouTube session cookie in Settings → YouTube accounts
- [ ] Done

---

### 2. No email finder keys configured (Hunter / Findymail / Prospeo)
- **Impact**: LinkedIn email lookup and domain-based lookup are completely skipped for every lead
- **Status**: `hunter_api_key`, `findymail_api_keys`, `prospeo_api_keys` all null in DB and env
- **Fix**: add at least one key in Settings → API keys
- Recommendation: start with **Prospeo** (free tier: 75 credits/month) or **Findymail** (free tier)
- [ ] Done

---

### 3. No email verification configured (Zerobounce / Neverbounce)
- **Impact**: inferred/guessed emails are saved unverified — bounce rate was 57% on early sends
- **Status**: `zerobounce_api_key` and `neverbounce_api_key` both null
- **Fix**: add a Zerobounce or Neverbounce key in Settings
- Zerobounce: 100 free credits/month
- [ ] Done

---

### 4. Bio link page is never scraped for emails
- **Impact**: many coaches list their email on their Linktree / personal site but not in the IG bio text
- **Status**: the pipeline fetches `external_link` to look for YouTube but never regex-scans it for emails
- **Fix**: add a scrape step after bio — visit `external_link`, extract any `mailto:` or email patterns from HTML
- Also try `/contact` and `/about` subpages
- [ ] Done

---

### 5. Link shorteners / Linktree domains wrongly used as personal domains
- **Impact**: `domain_inference` tries to guess email at `tr.ee`, `linktr.ee`, `whop.com` etc. — always fails, wastes a step
- **Status**: seen in traces: `domain_inference: no_mx_records(tr.ee)`
- **Fix**: blocklist known link-shortener and platform domains before running domain inference
- [ ] Done

---

### 6. Apollo.io not integrated
- **Impact**: Apollo has a large database of business emails — strong coverage for coaches/consultants
- **Status**: not in pipeline at all
- **Fix**: add Apollo domain+name lookup after Hunter in the waterfall
- Free tier: 600 credits/month
- [ ] Done

---

## What's working

- ✅ Instagram bio extraction
- ✅ YouTube channel discovery (via bio link scrape + Serper search)
- ✅ YouTube public About page scraping
- ✅ Domain inference (DNS MX pattern guess)
- ✅ Serper key configured (env var)
- ✅ CapSolver key configured (for YouTube gated reveal, once cookie is fixed)
