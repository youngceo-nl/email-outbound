# Email Enrichment — Improvement Backlog

_Audited: 2026-06-24_

Pipeline order: bio → website scrape → YouTube → LinkedIn → domain waterfall → domain inference

---

## Issues found (priority order)

### 1. YouTube gated cookie is broken
- **Impact**: was responsible for 10 confirmed email hits (largest single source after bio)
- **Status**: `YT_GOOGLE_COOKIE` env var is set but expired — traces show "not signed in"
- **Fix**: refresh the YouTube session cookie in Settings → YouTube accounts
- **Note**: auto-refresh is unreliable; this requires manual refresh when it expires
- [ ] Done

---

### 2. No email finder keys configured (Hunter / Findymail / Prospeo)
- **Impact**: LinkedIn email lookup and domain-based lookup are completely skipped for every lead
- **Status**: ✅ Fixed — 4 Prospeo keys + 4 Findymail keys added
- [x] Done

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
- **Status**: ✅ Fixed — `lib/email/website-scrape.ts` added; pipeline step 1b fetches `external_link` and subpages (`/contact`, `/about`, `/contact-us`, `/about-us`)
- [x] Done

---

### 5. Link shorteners / Linktree domains wrongly used as personal domains
- **Impact**: `domain_inference` tries to guess email at `tr.ee`, `linktr.ee`, `whop.com` etc. — always fails, wastes a step
- **Status**: ✅ Already handled — `extractDomain()` in `lib/email/domain-inference.ts` has a blocklist
- [x] Done

---

### 6. Apollo.io not integrated
- **Impact**: Apollo has a large database of business emails — strong coverage for coaches/consultants
- **Status**: ⚠️ Code added (`lib/email/apollo.ts`, wired into waterfall after Hunter) but `api/v1/people/match` is not available on Apollo's free plan — requires paid tier to use via API
- **Fix**: upgrade Apollo account if volume justifies it; code is ready
- [x] Done (code ready, gated on paid Apollo plan)

---

## What's working

- ✅ Instagram bio extraction
- ✅ Bio link / website email scraping (new)
- ✅ YouTube channel discovery (via bio link scrape + Serper search)
- ✅ YouTube public About page scraping
- ✅ Domain inference (DNS MX pattern guess)
- ✅ Serper key configured (env var)
- ✅ CapSolver key configured (for YouTube gated reveal, once cookie is fixed)
- ✅ Prospeo: 4 keys (75 searches/month each = 300/month)
- ✅ Findymail: 4 keys (~50 searches/month each = ~200/month)
