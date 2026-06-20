# Pipeline KPIs — Scrape to Send

_Last updated: 2026-06-20_

---

## Funnel (lifetime to date)

| Stage | Count | Rate |
|---|---|---|
| Total scraped | 5,745 | — |
| Pending (not yet scored) | 313 | — |
| Processed | 5,432 | 100% |
| **Rejected** | 5,178 | 95.3% |
| **Qualified** | 219 | 4.0% |
| **Review** | 35 | 0.6% |
| Passed (qualified + review) | 254 | **4.7%** |

---

## Email enrichment (of qualified/review leads)

| Source | Count |
|---|---|
| Instagram bio | 31 |
| Website scrape | 12 |
| YouTube gated | 10 |
| YouTube public | 5 |
| Domain inference (unverified) | 17 |
| Unknown (pre-tracking) | 77 |
| Manual | 1 |
| **Total with email** | **153** |

- Confirmed (`found`) emails: **136**
- Inferred (guessed, unverified): **17**
- Hit rate on qualified/review: **~31.5%**

---

## Outreach

| Metric | Count |
|---|---|
| Sent (total) | 7 |
| Bounced | 4 |
| Bounce rate | ~57% ⚠️ |
| Sent today | 0 |

> Bounce rate is inflated — 4/7 bounces are from platform-domain emails (youtu.be, whop.com etc.) that were cleaned from the DB on 2026-06-20. Future sends should have a much lower rate.

---

## Daily target math: 25 emails/day

Working backwards from 25 sends/day:

| Step | Required | Rate used |
|---|---|---|
| Emails to send | 25 | — |
| Qualified leads needed (to get 25 emails) | ~80 | 31.5% email hit rate |
| Profiles to score (to get 80 qualified) | ~1,700 | 4.7% qualification rate |
| Accounts to scrape (to get 1,700 scored) | ~2,800 | ~61% backfill success |
| Seeds needed per day | **~3–4** | ~800 followings/seed |

**Current runway**: ~62 qualified leads have emails and haven't been contacted. That's ~2–3 days of 25/day before the pipeline needs to catch up.

---

## What needs to happen to sustain 25/day

1. **Scrape 3–4 seeds/day** — currently doing ~1 per session manually. Needs to run on a schedule.
2. **Email hit rate is the biggest lever** — 31.5% means 2/3 of qualified leads have no email. Improving this (better YouTube scraping, adding Hunter.io for more domains) directly reduces the scraping burden.
3. **Bounce rate** — now that platform-domain emails are blocked, should drop significantly. Monitor after first real batch.
4. **Review leads (35)** — none of these are being sent to. If they're borderline qualified, they're low-hanging fruit.

---

## Engineering needed

- [x] Scheduled daily scrape (3–4 seeds, auto-picked from seed pool) — `daily-scrape.ts`, 02:00 UTC
- [x] Auto-trigger email enrichment on newly qualified leads — `enrich_emails_auto` setting already wired
- [x] Auto-queue 25 outreach emails/day at 09:00 — `daily-send.ts`, 08:00 UTC
- [x] Runway indicator on dashboard (ready-to-send, sent today, days of runway)

### Seed pool health

- [x] **Exhaustion detection**: seed is exhausted when `exhausted_providers` contains `cookie` (the only provider in use). Exhausted seeds hidden from active list and daily scrape cron; kept in DB so we never re-add them. Shown as footnote in SeedManager.
- [x] **Niche diversification in Suggested Seeds**: fetches 200-candidate pool, groups by `niche`, picks top 2 per niche, interleaves niches round-robin up to 15 suggestions.

### Outreach quality

- [x] Monitor bounce rate per send batch — `daily-bounce-check.ts` cron at noon UTC. Checks Gmail NDRs, marks bounces in DB, logs alert to activity feed if daily bounce rate > 10%.
- [x] Include `review` leads in daily send — borderline leads with emails now get sent to; expands daily pool by up to 35 contacts.
- [ ] Track reply rate — `reply_count` and `last_reply_at` are already stored on leads (synced via inbox page). Next: surface a reply rate % in this doc after first real batch completes.

### Reply rate (to be filled after first real batch)

| Metric | Count |
|---|---|
| Total sent (all time) | 7 |
| Confirmed replies | — |
| Reply rate | — |

> Update after running `Sync inbox` on the inbox page following a send batch.
