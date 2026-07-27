# VA Access Restrictions

No such doc existed before this one — this is the first pass, written after
checking the actual auth/access model in the codebase (not just the two
things you asked about).

## Short answer up front

**There is currently no concept of restricted/VA-tier access anywhere in this
app.** Every authenticated user — founder or VA — has 100% identical access
to every page and every row in every table. `middleware.ts` only checks "is
this person logged in at all," and every Row Level Security policy in
`supabase/migrations/` is written as:

```sql
for all to authenticated using (true) with check (true)
```

That's the login gate. There is no second gate.

---

## The two things you flagged

### 1. `/review` — inaccessible for VA
`app/(dashboard)/review/page.tsx` — the human-review queue for AI-qualified
leads (`getReviewQueue`, `getReviewStats`). Reachable today by anyone logged
in via the flat nav list in `app/(dashboard)/layout.tsx`; no per-item guard
exists on that nav or on the route itself.

### 2. Bad leads — inaccessible for VA
Not a separate route — it's the `<BadLeadsTable>` component embedded directly
inside `app/(dashboard)/leads/page.tsx` (line 345), backed by the
`rejected_leads` table. Rendered unconditionally to whoever opens `/leads`.

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

1. **Signup is open, not invite-only.** `app/(auth)/login/page.tsx` calls
   `supabase.auth.signUp()` directly. Anyone who reaches the login page can
   create their own account, and that account gets the exact same
   `authenticated` role as every other user — i.e., everything above, for
   free, without you provisioning anything. (Worth double-checking whether
   the Supabase project itself restricts signups at the dashboard level,
   outside this code.)

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

## What real VA-tier access would require

Not implemented — this is the shape of the fix, for you to react to before
anyone builds it:

- A role concept Postgres can actually see — either a custom claim on the
  Supabase JWT, or an app-level `user_roles` table joined into policies.
- RLS rewritten from blanket `using (true)` to a role check, at minimum on
  `rejected_leads`, `app_settings`, `api_usage_events`, `fixed_costs`, and
  wherever `review`-status leads live.
- Nav + route guards (`middleware.ts` / `layout.tsx`) so a VA never even sees
  `/review` or the bad-leads table rendered — as defense in depth *on top of*
  RLS, not instead of it.
- Closing open signup or gating it to an allowlist, so a VA account is
  something you explicitly provision rather than anyone-with-the-URL.
- Moving the secrets currently sitting in `app_settings` (OpenAI key, the 7
  Apify tokens) to server-only storage instead of a DB row every
  authenticated session can read.

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