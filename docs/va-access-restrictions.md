# VA Access Restrictions

**Status as of 2026-07-31**: implemented, then partially reversed by
request. The VA account (`va@theconversionbrands.com`) is tagged
`app_metadata.role = "va"` on its Supabase Auth record. Originally this
blocked both `/review` and the bad-leads table; **Review access was
explicitly restored on 2026-07-31** (this doc's history below), so today the
VA role only restricts the bad-leads table plus the secrets/billing tables
found while building this. Everything else in this doc reflects the
original investigation and is still accurate.

## Short answer up front

Originally (first pass, before any of this was built): every authenticated
user — founder or VA — had 100% identical access to every page and every
row in every table. `middleware.ts` only checked "is this person logged in
at all," and every Row Level Security policy in `supabase/migrations/` was
written as:

```sql
for all to authenticated using (true) with check (true)
```

That's the login gate described below — it's what the original "other
liabilities" section still refers to, and is **still true for every table
not explicitly listed as locked down** (see "Current state" below).

---

## The two things you originally flagged

### 1. `/review` — **restored for VA on 2026-07-31**, no longer restricted
`app/(dashboard)/review/page.tsx` — the human-review queue for AI-qualified
leads (`getReviewQueue`, `getReviewStats`). Was blocked at three layers
(`middleware.ts` redirect, nav filtering in `app/(dashboard)/layout.tsx`,
a page-level redirect) plus a DB-level RLS rule hiding review-queue-shaped
`leads` rows. All four were explicitly reversed by request — the VA now
sees this tab exactly like any other account, including the nav badge.

### 2. Bad leads — still inaccessible for VA
Not a separate route — it's the `<BadLeadsTable>` component embedded
directly inside `app/(dashboard)/leads/page.tsx`, backed by the
`rejected_leads` table. Both the UI (component not rendered, query not run
for a VA session) and the DB (RLS blocks the `rejected_leads` table outright
for `role = 'va'`) still restrict this — unchanged, still live.

---

## Why just hiding these two in the UI won't actually stop a VA

Removing a nav link or not rendering a component only changes what the page
*shows*. It doesn't touch what the account can *fetch*. Because:

- the Supabase anon key is public by design (it ships in the browser bundle
  — `NEXT_PUBLIC_SUPABASE_ANON_KEY`), and
- every table's RLS policy is `using (true)` for anyone with role
  `authenticated`,

a VA logged into their own account could open the browser console and run
`supabase.from('rejected_leads').select('*')` (or query `leads` where
`status = 'review'`, or any other table) and get the exact same data the
hidden UI would have shown — no server or database refusal happens. A real
restriction has to live in the database (RLS scoped to a role), not just in
what React renders.

---

## Other liabilities found while checking this

Went looking for anything else in the same category. Found four more, all
live right now:

1. **~~Signup is open, not invite-only.~~ Fixed — see "Current state" below.**
   `app/(auth)/login/page.tsx` used to call `supabase.auth.signUp()`
   directly, meaning anyone who reached the login page could create their
   own account with the exact same `authenticated` role as everyone else.
   That call was removed; sign-in only now. (Still worth double-checking
   whether the Supabase project itself also restricts signups at the
   dashboard level, outside this code, as defense in depth.)

2. **Live API keys sit in the `app_settings` table, not just `.env.local`.**
   Checked the live row directly: `openai_api_key` is populated, and
   `apify_api_keys` holds 7 stored tokens. `app_settings` has the same
   `using (true)` policy as everything else, so any authenticated
   session — VA or otherwise — can read a working OpenAI key and Apify
   tokens straight out of the table, regardless of how the Settings page UI
   masks that input field.

3. **Billing/cost data is equally open.** `api_usage_events` and
   `fixed_costs` — exact per-lead AI spend, provider costs, and whatever
   fixed costs you've entered — are queryable by any authenticated account.

4. **All outreach and inbox data is fully open**, not scoped to whoever is
   "assigned" to a lead or campaign — every sent email and every reply,
   across every campaign, to any authenticated account.

There's also no audit trail anywhere (no table records *who* changed a
lead's status, edited a setting, or sent a message) — if a VA account did
something unexpected, there's currently no way to tell what they touched.

---

## Current state (built, then Review partially reversed)

Everything below this line WAS implemented, not just proposed:

- **Role concept**: `app_metadata.role = "va"` on the VA's Supabase Auth
  user (set via the Admin API — `app_metadata` is not user-editable, unlike
  `user_metadata`, so the VA can't grant itself a different role). RLS
  policies read it via `(auth.jwt() -> 'app_metadata' ->> 'role') = 'va'`.
- **RLS rewritten from blanket `using (true)` to a role check** on:
  `rejected_leads` (fully blocked for VA), `app_settings` (fully blocked —
  this is where the OpenAI key and Apify tokens live), `api_usage_events` and
  `fixed_costs` (fully blocked, billing data). `leads` was *also* locked down
  (hiding review-queue-shaped rows) but that specific carve-out was reversed
  on 2026-07-31 — `leads` RLS is back to `using (true)` for everyone,
  VA included.
- **Nav + route guards** (`middleware.ts` / `app/(dashboard)/layout.tsx`) —
  built for `/review` specifically, then removed again on 2026-07-31 per the
  same request that relaxed the `leads` RLS above. No nav/route guard exists
  for the bad-leads table since it was never a separate route — its
  restriction is query-level + component-level inside `/leads`, both still
  in place.
- **Self-service signup removed** — `app/(auth)/login/page.tsx` no longer
  calls `supabase.auth.signUp()`; sign-in only. New accounts require the
  Admin API now, not "anyone who reaches the login page."
- **Not done**: moving the `app_settings` secrets to server-only storage
  instead of a DB row (RLS now blocks VA from reading that row directly, so
  the immediate risk is closed, but the OpenAI key/Apify tokens still
  physically live in a table rather than env-only storage for whoever *can*
  read `app_settings`).

## Out of scope here

If "VA account" ever means handing over the repo or local dev environment
(not just an app login), that's a bigger and separate problem: `.env.local`
holds the Supabase **service role key** — which bypasses RLS entirely,
regardless of any of the fixes above — plus every third-party API key and
session cookie in plaintext. That file should never leave a fully-trusted
set of hands.


•    Email: va@theconversionbrands.com
•    Password: xFeD_UvE8RcSU_e4NaU4ynq9
this is the VA account