# email-outbound

## API keys — always the database, never `.env.local`

**This repo is public and more than one person works on it. A key in `.env.local`
is a key only one laptop has.**

When the user gives you an API key, put it in the `app_settings` row (`id = 1`):

```bash
echo -n "<the key>" | npx tsx scripts/set-api-key.mts <column>
npx tsx scripts/set-api-key.mts --list    # columns + which are already set
```

The value goes in on **stdin, never as an argument**, so it stays out of shell
history and the process list. `--list` masks every value it prints.

Rules:
- Do **not** append keys to `.env.local`. It is gitignored, so it is not a leak
  risk — it is a *sync* risk: teammates and deploys silently run without the key.
- Do **not** paste a key into any file that git tracks, including migrations,
  test fixtures, or docs.
- If the key needs a column that does not exist, write a migration for it first.
  `set-api-key.mts` deliberately refuses unknown columns so a typo cannot
  overwrite an unrelated setting.
- After storing a key the user pasted into chat, tell them it is worth rotating.

`app_settings` is RLS-protected to authenticated non-VA users
(`20260726000000_va_role_lockdown.sql`) and is what the Settings page edits, so
storing a key there is what makes it available to the whole team.

Most readers already prefer the database with env as fallback, e.g.
`s.hikerapi_api_key || process.env.HIKERAPI_KEY`. Two exceptions to know about:
- `APIFY_TOKEN` reads **env first**, so a stale local env var beats what the team
  set in the UI (`lib/config/settings.ts:40`).
- `STEEL_API_KEY` is **env-only** — `scripts/experiments/browser-backend.ts:82`
  throws without it and there is no `steel_api_key` column yet. Until that is
  wired, Steel is the one credential that still has to live in `.env.local`.

## Supabase access

The Supabase JS client (service role key in `.env.local`) supports data queries
(SELECT, INSERT, UPDATE, DELETE) but **cannot run DDL** (ALTER TABLE, CREATE TABLE).

For schema migrations:
- `npx supabase` is available and the project is already linked
  (`--project-ref mxngjwyfomahzswcgkwu`)
- **Do not run `npx supabase db push`.** The remote's migration history table is
  empty while the schema is largely applied, so a push replays all ~43 migrations
  against tables that already exist. Verify with `npx supabase db push --dry-run`
  before ever reconsidering this.
- Instead: hand the user the migration SQL to paste into the dashboard SQL editor,
  and write migrations idempotently (`if not exists`, `drop policy if exists`) so
  re-running is always safe.
- Migration files live in `supabase/migrations/`

Data queries work fine — use `createAdminClient` from `@/lib/supabase/admin` with a
`.mts` script and `npx tsx <script>`, then delete the script after. Note that
`lib/config/settings.ts` is `server-only` and cannot be imported from such a
script; query `app_settings` directly instead. Scripts must load `.env.local`
themselves — `tsx` does not do it the way Next does.
