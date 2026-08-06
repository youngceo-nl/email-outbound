# Status

Last updated: 2026-08-04

## Priority shift: functional first, efficiency paused

Efficiency tuning (below) is paused. Current focus: make Steel actually **usable** — the real driver is `email-outbound` (github.com/youngceo-nl/email-outbound), a Vercel-hosted lead-gen pipeline that needs to reach Steel on this PC over the internet. See ADR-006 for the full architecture decision.

**Update 2026-08-04:** user decided to actually apply/use this setup (wire Steel into `email-outbound`'s real usage) *before* returning to machine optimization — efficiency work (items 5-9 below) stays paused until the use case is actually running, not just reachable. Auto-start hardening (BIOS setting, re-verifying reboot-survival) is also separately paused, see above.

**`email-outbound` cloned locally** at `C:\Users\tokki\OneDrive\Documenten\GitHub\email-outbound` (sibling of this repo and `steel-browser`), from `github.com/youngceo-nl/email-outbound`. Has its own `CLAUDE.md` — a Next.js lead-gen pipeline with its own conventions, separate from this repo's.

**Traced its Steel call path, found + fixed four real integration gaps, and proved the whole chain end-to-end with a real run.** Path: `lib/instagram/steel-acquisition.ts` → `scripts/experiments/playwright-instagram-complete.ts` → `scripts/experiments/browser-backend.ts`. Full detail in ADR-008 and ADR-009.
1. **Fixed, verified live.** This PC's Steel container was still advertising `DOMAIN=localhost:3000` (upstream default) — `session.websocketUrl` came back as a `localhost` address, useless off this PC. Fixed via `DOMAIN=steel-api.paidinfunnel.com` + `USE_SSL=true` in `deploy/docker-compose.override.yml`.
2. **Fixed, verified live.** `browser-backend.ts` sent no `CF-Access-Client-Id`/`CF-Access-Client-Secret` on either the Steel SDK session-create call or the `chromium.connectOverCDP` WebSocket — Cloudflare Access would `403` both independently. Added both, falling back to `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET` env vars.
3. **Resolved.** The `email-outbound` Service Token was rotated via the Cloudflare dashboard (Zero Trust → Access → Service Tokens). New credential pair lives in `email-outbound/.env.local` (git-ignored there, **not** written into this repo).
4. **Found and fixed during the actual test run (new — ADR-009).** Even with 1-3 fixed, the CDP connection got a `500` straight from Chrome: *"Host header is specified and is not an IP address or localhost."* Root cause is in `steel-browser`'s own `cdp.service.ts` — it proxies the CDP WebSocket to Chrome without `changeOrigin`, so the public `Host` header reaches Chrome's built-in anti-DNS-rebinding check unchanged. Fixed at the Cloudflare Tunnel layer instead of patching `steel-browser`: added an `originRequest.httpHostHeader: "localhost:3000"` override to the tunnel's ingress config via the Cloudflare API, forcing `cloudflared` to rewrite the header before it reaches the container.

**Also installed Node.js LTS (24.19.0) on this PC** — wasn't present at all before this session, and is now required to run anything in `email-outbound` (Next.js/TypeScript). Confirmed with the user before installing, per this repo's convention on software installs. `npm install` run in the clone (875 packages).

**Verified end-to-end with a real run**, 2026-08-04: `npx tsx scripts/experiments/playwright-instagram-complete.ts --steel` (no Instagram login cookie, so no real account/proxy at risk) — Steel session created through Cloudflare Access, Chrome accepted the CDP connection, Playwright drove real browser automation against a live (logged-out) Instagram profile page through the full public path, session closed cleanly, nothing left dangling. This is the first real proof the whole architecture (ADR-006 tunnel+Access, ADR-008 headers+DOMAIN, ADR-009 Host header) actually works together, not just in theory.

**Not yet done:** a real *authenticated* acquisition (real Instagram login cookie + pinned residential proxy + real account) — today's test deliberately stayed logged-out to keep it low-risk. That's the next real test when ready, and it's a bigger step given the ban-risk considerations already called out in `steel-acquisition.ts` itself.

**Session continued (2026-08-04, later): built a Steel-driven Instagram login/onboarding flow — see ADR-010 for full detail.** Short version:
- Checked whether the ADR-008 Cloudflare Access header fix actually made it into `email-outbound` — it hadn't (never committed, despite the doc trail above saying it was verified live). Re-applied it in `browser-backend.ts`.
- Added `email-outbound/scripts/onboard-instagram-account.ts` — opens a Steel session with no cookie, prints Steel's live-viewer URL so a human logs into Instagram through it directly (2FA/checkpoints handled by the human, password never touches the script), captures the resulting cookie, writes it into `app_settings.instagram_accounts` behind `--apply`.
- Both changes type-check clean (`npx tsc --noEmit`, whole project). **Not run live yet** — this clone's `email-outbound/.env.local` doesn't exist at all, so `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STEEL_BASE_URL`, `STEEL_API_KEY`, and `CF_ACCESS_CLIENT_ID`/`SECRET` are all unset locally. `node_modules` was also missing (re-ran `npm install`, 875 packages, matches the earlier count).
- **Credentials sourced, and the whole chain proven live end-to-end with a real authenticated run.** User rotated the Cloudflare Access Service Token secret and pulled the Supabase service role key; both verified working via a throwaway smoke test (Supabase read succeeded; Steel session created through Cloudflare Access with no 403).
- **Found and fixed two more real bugs while verifying:**
  1. `browser-backend.ts`'s "live viewer URL" preferred `session.sessionViewerUrl` over `session.debugUrl`. On a self-hosted instance, `sessionViewerUrl` is a Steel Cloud concept — a hardcoded placeholder (`getBaseUrl()`, the bare domain, identical on every session) — while `debugUrl` (`/v1/sessions/debug`) is steel-browser's actual live-debugger HTML page. Swapped the priority. Confirmed via raw `curl` through Cloudflare Access that `/v1/sessions/debug` returns real HTML (200, ~67KB, "Steel Session Player") — this specific page had never actually been confirmed reachable over the tunnel before, only the raw CDP WebSocket had (ADR-009).
  2. **Bigger one:** shared `app_settings.steel_base_url` in Supabase was stale — set to `http://localhost:3555`, not the real tunneled `https://steel-api.paidinfunnel.com`. Since the DB value takes priority over env everywhere this is read, this would have silently broken Steel connectivity for **any** caller reading shared settings, including the real Vercel deployment — independent of everything else fixed today. Corrected in the DB directly.
  3. **Not fixed, deferred:** the (currently-disabled, cron="0 3 1 * *") `refresh-ig-cookies.ts` automated login path — `login-playwright.ts` — is actually a raw-HTTP-fetch mimic of Instagram's login AJAX endpoints, not real browser automation despite the filename. Left alone; the new Steel-driven human login path added today doesn't touch or depend on it.
- **Verified live, 2026-08-04/05:** ran `email-outbound`'s real acquisition path (`runPlaywrightInstagramComplete`, backend `steel`) using an **already-authenticated existing account** (`masakonjoku61`, group C, its own pinned Oxylabs proxy `disp.oxylabs.io:8001`) against a real public profile (`@natgeo`). Result: `authenticated: true`, `challenge: none`, zero errors, profile captured with real data (268,874,261 followers). **This is the first real fully-authenticated run through the complete stack** (self-hosted Steel → Cloudflare Tunnel → Access → real Chromium → real logged-in Instagram session), not just the earlier logged-out proof.
- **`onboard-instagram-account.ts` itself — still not run for real.** Original plan was to test it against a genuinely fresh account (`livelypageant8`, group C, paused, cookie never set) to prove the new Steel-driven human-login capture path specifically (as opposed to just re-using an already-working cookie, which is what the `natgeo` test above did). Blocked on a proxy: all 5 Oxylabs dedicated ports are already claimed by the other group-C accounts, and reusing one would link two accounts to the same exit IP — the exact thing `assign-oxylabs-proxies.ts` refuses to do. **Deliberately deferred, not urgent** — user's call, didn't want to wait on a 6th port or a manual proxy right now. Revisit when a spare proxy exists; `livelypageant8` is the queued candidate.

**`.gitignore` fixed (2026-08-04):** was `.env` / `*.env`, neither of which actually matches `*.local`-suffixed files like `.env.local` — confirmed gap via `git check-ignore` (no match). Changed to `.env*`, verified it now catches `.env.local` too.

**Cleanup owed — two Cloudflare API tokens outstanding and unrevoked. Tried to close this out programmatically; both require the dashboard, not something further automatable here:**
- The narrower token created today (Account → Cloudflare Tunnel: Edit only, used for the ADR-009 Host Header fix) — attempted self-revoke via `DELETE /user/tokens/{id}`, got `9109 Unauthorized to access requested resource`: the token's own permission scope (Tunnel:Edit) doesn't include the "User API Tokens" permission needed to revoke tokens, including itself. Its local copy (session scratchpad) has been deleted, but the token itself is still live on Cloudflare's side until revoked via `dash.cloudflare.com/profile/api-tokens`.
- The original broad setup token from ADR-006 (DNS + Access + Tunnel edit) — still unrevoked, and its value was never saved anywhere (by design), so there's no way to even identify/target it via API. Dashboard-only, same place as above.

**Plan for testing `email-outbound` against Steel, and caveats to keep in mind (background, mostly superseded by the successful run above — kept for the reasoning):**
- Intent is to clone `email-outbound` onto this same PC and run/test it locally against this PC's Steel setup, rather than only testing from a genuinely separate machine.
- **This is expected to validate the real path, with one condition:** Cloudflare Tunnel routes purely by public hostname — it doesn't matter physically where the calling request originates (this PC, another PC, or Vercel's actual servers), Cloudflare's edge routes it down the tunnel back to this PC regardless. So a local clone calling the real public URL exercises the same DNS → Cloudflare Access → tunnel → `cloudflared` → `localhost:3000` path as production, **as long as it actually calls `https://steel-api.paidinfunnel.com` with the `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers** — same as the real deployed version.
- **Caveat 1 — don't accidentally bypass the tunnel:** if the local run (e.g. via a dev-mode branch, or a `.env.local` override) ends up pointing at `http://localhost:3000` directly instead of the public hostname, it would skip Cloudflare Access entirely. That would "work" but wouldn't actually prove the production path — false confidence. Double-check which URL the local run is actually hitting.
- **Caveat 2 — local dev isn't a perfect stand-in for deployed Vercel:** running via `npm run dev` / `vercel dev` on this PC isn't byte-for-byte identical to an actual deployed Vercel serverless function (different Node runtime specifics, execution timeout limits, cold-start behavior). Good enough to validate integration logic and the Steel/Cloudflare path, but a real test against the actual deployed Vercel instance is still needed before calling this fully proven end-to-end.
- Also remember: the Access **Service Token secret for `email-outbound` was never saved anywhere** (see below) — testing this integration will need that secret sourced or rotated first.

## Steel remote reachability + auth — done, verified live

Public endpoint: **`https://steel-api.paidinfunnel.com`** → routes to this PC's Steel API (`localhost:3000` only — not the UI, not the CDP port). Protected by Cloudflare Access; verified with curl: no auth headers → `403`, valid Service Token headers → `200` with real session data. Full architecture and the tunnel-ID-collision war story in `decisions.md` ADR-006.

**Things that must not get lost:**
- **Access Service Token for `email-outbound` to use** — Client ID `38d91b5dac008cf1d147c9cbc8a88ad9.access`, Client Secret was shown once at creation and is **not recorded anywhere in this repo**. If it wasn't saved to a password manager at creation time, it's gone — rotate it via Cloudflare dash → Zero Trust → Access → Service Tokens → `email-outbound` → Rotate, and update wherever it ends up being used.
- **cloudflared runs as a Windows service** (`Cloudflared`, Automatic start) using a tunnel token stored locally at `C:\ProgramData\cloudflared\token` (not in this repo, not reproduced in docs). If that file is ever lost, regenerate a token from the dashboard (Networks → Tunnels → `steel-api-01` → the token is tied to the tunnel, not rotatable from the CLI side — use "Refresh token" in the tunnel's details panel) and reinstall: `cloudflared service uninstall` then `cloudflared service install <new-token>`.
- **A broadly-scoped Cloudflare API token** (DNS edit + Access edit + Tunnel edit, restricted to the `paidinfunnel.com` zone/account) was used to script the DNS/Access/Tunnel setup via curl. **Recommended to revoke or scope it down now** — not yet confirmed done. Check dash.cloudflare.com/profile/api-tokens.
- If `email-outbound` (or anything else) needs to call Steel, it must send both `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers with the values above — without them Cloudflare blocks the request before it reaches this PC.

**Still open from this effort:**
1. **Windows auto-login decision** — enabled and **confirmed working**: after an unattended restart, the PC lands on the desktop without manual password entry. (Docker Desktop needs a logged-in session to relaunch after reboot — confirmed it cannot run as a Windows service — so this was the fix.)
2. **BIOS "Restore on AC Power Loss"** — not software-settable, needs a manual check in BIOS/UEFI setup so the box survives an actual power outage, not just planned reboots. Not yet done.
3. **Reboot-survival test — done, verified live, with one bug found and fixed.** Full chain checked after the real unattended restart:
   - Auto-login → desktop: verified.
   - **Docker Desktop did NOT come back on its own** — found not running 7+ minutes post-boot. Root cause: Docker Desktop's own `AutoStart` setting was `false` in `%APPDATA%\Docker\settings-store.json`, despite a leftover Windows `Run` registry entry pointing to it (that registry entry alone doesn't launch it — Docker checks its own setting and no-ops). **Fixed**: stopped Docker Desktop, edited `AutoStart` to `true` in that file, restarted — setting persisted through the restart, confirmed via `docker desktop status`. Not yet tested across an actual full reboot (only a Docker Desktop stop/start), so treat as fixed-but-unconfirmed-across-reboot until the next real restart.
   - Once Docker Desktop was up, `restart: unless-stopped` did attempt to bring the containers back automatically, but `steel-browser-api-1` crashed on its first launch attempt (`TargetCloseError: Protocol error (Page.addScriptToEvaluateOnNewDocument): Session closed` — Puppeteer/CDP failure attaching to Chromium, likely a resource-contention hiccup from Docker's backend still settling right after its own restart). The container did not auto-retry within ~48s despite the restart policy (`RestartCount` stayed `0`) — worth watching, not yet understood why. Manual `docker start steel-browser-api-1` succeeded cleanly on the second attempt; `steel-browser-ui-1` started fine.
   - Confirmed after manual restart: both containers `Up`, `http://localhost:3000/v1/sessions` → 200, `http://localhost:5173` → 200, `Cloudflared` service `Running`/`Automatic`, public endpoint `https://steel-api.paidinfunnel.com/v1/sessions` → 403 with no auth headers (expected/healthy — matches the original verified baseline).
   - **Net result: the full stack does not yet survive an unattended reboot unattended** — it needed one manual settings fix (now applied) and one manual container restart (transient, cause not fully understood). Re-run this test on the next real reboot to confirm the `AutoStart` fix holds and see whether the API crash-on-cold-start recurs.
4. LAN hardening note: steel-browser's Docker ports are still bound `0.0.0.0` (a Docker Desktop WSL2 bug blocked binding to `127.0.0.1` directly — see ADR-006's "rejected alternative"). A Windows Firewall rule (`Steel API - block non-local`) blocks inbound access to ports 3000/9223/5173 from anything but localhost instead. Verified working, but worth knowing this is a firewall-level control, not a Docker-level one — don't remove that firewall rule without understanding why it's there.

## Controlled wattage baseline — done

Idle/load pair recorded under confirmed Server Mode + post-ADR-005 conditions: **61W idle / 65W loaded (one Steel session)**, tower only. Full detail and caveats in `hardware.md`. Superseded the earlier general 120W reading — see `hardware.md` for the note on that gap (multiple variables changed, not a clean isolated comparison).

Found and fixed along the way: the **Server Mode** power plan had reverted to Balanced at some point since ADR-004 (despite the assumption it would persist) — re-set via `powercfg /setactive ccb9b17b-c54f-46b7-a6c1-630be4cf5a2a`. Docker Desktop was also not running; restarted it and confirmed both containers came back via `restart: unless-stopped` with no manual compose command needed.

## Current state

- Repo initialized as the tracking project.
- Hardware baseline recorded (`hardware.md`), including a real `powercfg /energy` diagnostic pass — see `energy-report-2026-08-04.html`. No actual wattage yet (that tool reports problems, not watts).
- WSL2 + Ubuntu installed and running (confirmed via `wsl -l -v`). Note: Ubuntu did not prompt for the usual first-run Unix username/password setup — left as-is per user; revisit if it causes issues (e.g. running commands as root by default).
- Docker Desktop 4.85.0 installed via winget, launched, logged in, using the WSL2 backend. Confirmed working: `docker --version` → 29.6.2, `docker info` responds. Note: PATH only picked up in new shell sessions started after install.
- ADR-001 and ADR-002 recorded (see `decisions.md`) — ADR-002 now Accepted.
- **steel-browser deployed and running.** Cloned upstream to `../steel-browser` (sibling of this repo, kept pristine for `git pull`). Resource limits (api: 2 CPU/4GB, ui: 0.5 CPU/512MB, both `restart: unless-stopped`) live in this repo at `deploy/docker-compose.override.yml` since upstream sets none. Started with:
  ```powershell
  cd ../steel-browser
  docker compose -f docker-compose.yml -f ../self-hosting-server/deploy/docker-compose.override.yml up -d
  ```
  Verified working: `steel-browser-api-1` and `steel-browser-ui-1` both `Up`; API responds 200 on `http://localhost:3000/v1/sessions`; UI responds 200 on `http://localhost:5173`.
- **`powercfg /energy` findings acted on** (see ADR-004):
  - New **"Server Mode"** power plan created (GUID `ccb9b17b-c54f-46b7-a6c1-630be4cf5a2a`), duplicated from Balanced, with video playback settings switched to power-saving on AC/DC. **Currently active.** Original Balanced plan untouched — switch back via `powercfg /setactive 381b4222-f694-41f0-9685-ff5bb260df2e` or Settings → Power & battery when using this PC interactively.
  - USB Selective Suspend: investigated, not changed — already Enabled at plan level; the 3 flagged devices are keyboard/mouse peripherals, expected to stay out of suspend, negligible power impact.
  - Wireless radio policy: not applicable, machine is on wired Ethernet.
- **Startup apps / background services audit acted on** (see ADR-005): disabled login autostart for Steam, Battle.net, Notion, Loom, Edge startup boost. Fully uninstalled NordVPN + NordUpdater (app, services, all traces — was a user request to remove, not just disable). Stopped + disabled Dell OEM services (AWCCService, DellClientManagementService, DellTechHub). Left DiagTrack/SysMain/WSearch untouched pending decision. No wattage impact measured yet.

## Next steps

**Functional work (current priority):**
1. ~~Decide on Windows auto-login~~ — done, enabled and confirmed working.
2. **Paused — BIOS "Restore on AC Power Loss".** Deliberately deferred by user (2026-08-04): "skip auto start up for now, leave that for when everything else is perfect." Not abandoned, just not being worked until other priorities land.
3. ~~Run the reboot-survival test~~ — done once; found Docker Desktop's `AutoStart` setting was off (fixed) and a transient API cold-start crash (self-resolved on manual retry, cause not fully understood). **Re-verifying this across an actual full reboot is also paused** per the same deferral — the `AutoStart` fix is applied but only proven via a Docker Desktop stop/start, not a real reboot, until this is picked back up.
4. Revoke or scope down the Cloudflare API token used for setup. (Not part of the auto-start deferral — still open, just blocked on the user doing it via the Cloudflare dashboard.)

**Efficiency work (paused, resume after the above):**
5. ~~Figure out why the **Server Mode** plan reverted to Balanced~~ — investigated 2026-08-04, **inconclusive but likely already fixed as a side effect.** Checked: Group Policy power settings (none set), scheduled tasks matching Dell/Alienware/Power (none), Windows Update history (nothing correlates — last update 7/7/2026, weeks before the revert), System event log for power-scheme-change entries (Windows doesn't log plan switches by default, nothing found). No direct evidence of what flipped it. Leading suspect was Dell's own power-management services (`AWCCService`, `DellClientManagementService`, `DellTechHub`) — Dell/Alienware tools are known to auto-switch power plans — and those are confirmed **stopped + disabled** already (done in ADR-005, before this investigation). So there's currently no known live mechanism that would revert it again, but this isn't proven causation, just "the suspect is gone." **Keep watching**: if Server Mode reverts again despite those services staying disabled, the cause is something else and needs a fresh look.
6. Test wattage under heavier/concurrent load (multiple simultaneous Steel sessions, longer sessions) — current loaded reading (65W) is only a single light session, so the marginal per-session cost at real usage levels is still unknown.
7. Decide on DiagTrack / SysMain / WSearch (telemetry + Superfetch + Windows Search indexing) — flagged during the startup/services audit but not yet acted on.
8. Consider whether the api/ui resource limits in `deploy/docker-compose.override.yml` need tuning once real usage patterns are known.
9. Remember to switch back to the **Balanced** plan when using this PC as a regular desktop — Server Mode trades video quality for power savings and there's no auto-switch.

## Repo merged into email-outbound (2026-08-05)

User decided to self-host the whole `email-outbound` app on this PC too, not just Steel — this repo (`self-hosting-server`) has been merged into `email-outbound` via `git subtree` (full history preserved, both original commits `e805e4f`/`2f34df4` are real ancestors of the merge commit, verifiable via `git log <merge-commit>^2`). This doc, and everything else that was in this repo, now lives at `email-outbound/infra/self-hosting/`. The standalone `self-hosting-server` GitHub repo and local clone are slated for archival once the merged copy is confirmed good — not done yet, see the email-outbound side of this work for current status.

**Steel's compose invocation path changed** as a direct consequence — the override file moved:
```powershell
cd ../steel-browser
docker compose -f docker-compose.yml -f ../email-outbound/infra/self-hosting/deploy/docker-compose.override.yml up -d
```
(previously `../self-hosting-server/deploy/docker-compose.override.yml`).

email-outbound itself now also runs in Docker on this PC (see `infra/self-hosting/deploy/docker-compose.app.yml` and the root `Dockerfile`) — full detail in `email-outbound`'s own `CLAUDE.md` and commit history from this point forward, since new decisions about the app itself belong there, not in this doc.

## Remote access live + the app is not actually broken (2026-08-05)

**Remote access from the Mac is working (ADR-012).** Tailscale on both machines, Windows OpenSSH Server enabled, key-based login confirmed: `ssh self-hosting-pc` reaches `tokki@DESKTOP-8N83F8S`. The PC's Tailscale name is `desktop-8n83f8s` (`desktop-8n83f8s.tail537ab3.ts.net`, `100.119.195.52`); the Mac's `~/.ssh/config` maps the stable alias `self-hosting-pc` onto it. SSH is firewalled to the Tailscale CGNAT range only. Setup steps in `remote-access.md`. This does **not** reverse ADR-006 - that rejected Tailscale for *Vercel serverless* reaching Steel, which still holds and still uses the Cloudflare Tunnel.

**With access, the actual state of the box was checked, and the app is substantially healthy.** `/login` returns 200, `/leads` returns 307 (the correct unauthenticated redirect), the Supabase URL is properly baked into the built middleware, and all three containers are up. **Two successive root-cause claims made by reading code were both wrong** - see ADR-014, which supersedes ADR-013's diagnosis.

**The one real fault:** `INNGEST_EVENT_KEY` on this box is an Inngest **Cloud** key belonging to a *branch* environment, and `INNGEST_ENV` is unset, so every send fails with `400 Branch environment name is required`. That is the only error in the container's entire log, and it fired once - from a user action, not from page rendering (`app/(dashboard)/leads/page.tsx` imports no Inngest client). Consequence: page loads, Supabase reads and the Steel path all work; every Inngest-dispatching action (crawl start, scoring, acquisition fan-out, bulk lead ops) fails. Inngest Cloud *can* reach the app - `GET` and `PUT` on `https://app.paidinfunnel.com/api/inngest` both return 200, so Cloudflare Access is not in the way.

There is no self-hosted Inngest container on this box and there never was one; the env template's `<from your self-hosted inngest>` placeholder described something that was never the plan. The fix is Production keys from the Inngest Cloud dashboard.

**Added in `email-outbound` (committed but not yet exercised against the box):**
- `deploy/deploy.ps1` - pull, validate `.env.production`, build with `--env-file`, health-check `/login`, dump `docker logs` on failure. Never run yet.
- `deploy/deploy-remote.sh` - drives the above from the Mac over SSH. **Does not touch the PC's `.env.production` unless `--push-env` is passed.**
- `.env.production.example` at the repo root, plus a `.gitignore` exception so it is actually tracked.
- `docs/remote-access.md` - the Tailscale + OpenSSH setup, including the `administrators_authorized_keys` ACL gotcha.

**Near-miss worth remembering:** the PC's `.env.production` is the source of truth and holds `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `INNGEST_DEV` and `STEEL_API_KEY` that the Mac's `.env.production.generated` has never had. The first version of `deploy-remote.sh` pushed the Mac's copy by default and would have destroyed all four. Now opt-in, diffs key names first, refuses to drop keys without `--force`, and backs up the remote file.

**Credential exposed:** the Inngest event key was printed in full to a terminal while inspecting the container environment. Rotate it - which pairs with needing new Production keys anyway.

**RESOLVED, same day.** A new Production event key was created in Inngest Cloud and written into the PC's `.env.production` over SSH; the container was recreated with `docker compose --env-file .env.production -f ... up -d`. Verified, not assumed:

- A real event send from inside the container returns `HTTP 200 {"ids":["01KZ96N6ZQ..."]}` - previously `400 Branch environment name is required`.
- `PUT https://app.paidinfunnel.com/api/inngest` returns `{"message":"Successfully registered","modified":true}`, so the app's functions are now registered against **Production** rather than a branch environment.
- `/login` 200, `/leads` 307, and the container log is completely clean since the recreate.

Notable: the **signing key on the box was already `signkey-prod-*`** - only the event key had been a branch-environment one, which is why the failure looked stranger than it was.

## Deploy pipeline working end to end (2026-08-05, later)

**`deploy-remote.sh` now does a full deploy from the Mac in one command, and has been run for real.** Verified: build from freshly pulled source, container replaced, health check green locally and from the Mac, event send `200`, app re-registered against Inngest Production.

Getting there took five runs and found five separate defects, all of which were invisible until the scripts were actually executed - see ADR-015. The load-bearing one: **`docker build` cannot run over an SSH session on this box.** Windows OpenSSH key auth yields a network logon token, and Docker Desktop's credential helper needs DPAPI access that such a token does not have. No Docker setting fixes it (four were tried). `run-interactive.ps1` hands the build to a scheduled task registered `/IT`, which runs in the already-logged-on desktop session. Commands that skip the credential store - `docker ps`, `exec`, `logs`, `compose up` without `--build` - work fine over plain SSH, which is why everything before this point worked.

**Note the new dependency:** deploys now require the PC to be *logged in*, not just powered on. Auto-login already covers that (ADR-007), but a reboot stopping at the login screen would break deploys, not only Docker.

**Also: the PC had been 16 files / 737 insertions behind `main`** - its running image predated the Cloudflare Access work entirely. That is now built in and confirmed present in the image.

**A helper script written this session corrupted two live credentials.** `set-inngest-keys.ps1` read its hidden prompt with `PtrToStringAuto`, which returns only the first character of a BSTR, so both Inngest keys were written as 1-character values while the script reported success. Caught by a post-deploy event send returning 404, and recovered from the timestamped backup the script had taken. Replaced by `deploy/set-env-value.ps1`, which uses `PtrToStringBSTR`, refuses values under 8 characters, and prints the written length. **Use that one for any future key change; do not resurrect the old script.**

**Pipeline verified end to end, 2026-08-05.** Sent `leads/backfill.metadata.requested` for a deliberately non-existent username: Inngest Cloud accepted it (`200`), invoked the function over the public URL, and it ran to completion and wrote `crawl_logs` id 25824 (`profile_acquisition_queued`, `requested=1 queued=0 missing=1`). That is the whole chain - app -> Inngest Cloud -> function execution -> Supabase - proven rather than inferred. No Apify, Instagram or AI calls were made; the adapter resolves usernames to lead IDs and fans out, nothing more.

**Two earlier notes in this doc were wrong and are corrected here:**
- `supabase/migrations/20260806000000_steel_cf_access.sql` is **already applied**. `steel_cf_client_id` and `steel_cf_client_secret` exist on `app_settings` and are populated (39 / 64 chars). Nothing to paste.
- `anthropic_api_key` being NULL is **not** a problem: `scoring_provider` is `openai`, `openai_api_key` is set, `openai_model` is `gpt-4o-mini`. Anthropic is not in the scoring path.

**The real capacity limit is proxies, not anything about the deploy.** `lib/instagram/cookie-pool.ts:53` skips any account without a `proxy_url` outright (`if (!cookie || !proxyUrl || !accountUsername ...) continue`), and there is no fallback: `instagram_proxy_pool` is empty and `instagram_proxy_url` is NULL. Current state of the 16 accounts:

- **4 usable** - `masakonjoku61`, `bethannbuczek1`, `allinedowho`, `jeanettaze`. All group C, all on their own Oxylabs dedicated port. At `max_profiles_per_account = 1000` that is ~4000 profiles of headroom, so this is a scale ceiling, not an outage.
- **10 have valid cookies but no proxy** (groups A and B) and are therefore invisible to the pipeline. This is the single highest-leverage fix: they need proxy ports, and status.md already records all 5 Oxylabs dedicated ports as claimed.
- Several group-B accounts additionally carry `checkpoint_state` or verification errors and need a re-login through `onboard-instagram-account.ts` - which itself needs a spare proxy first, so proxies gate that too.
- `ilenekawchpw` quarantined on a checkpoint; `livelypageant8` still cookie-less and paused (the long-deferred onboarding test candidate).

## Unattended operation (2026-08-06)

**Reboot survival is proven, not assumed.** The box rebooted mid-session and recovered with no intervention: `Tailscale`, `sshd` and `Cloudflared` all `Running`/`Automatic`, Docker Desktop `AutoStart: True`, every container back up, confirmed ~2h later from the Mac. This closes the item that had been "fixed, but only proven via a Docker Desktop stop/start, never a real reboot".

**Everything operational is remote.** Deploys, `docker logs`/`exec`/`restart`, database queries, Steel - none of this session's work needed physical access.

**The only remaining tie to physical presence is power.** BIOS "Restore on AC Power Loss" is still unset (deferred 2026-08-04) and there is no Wake-on-LAN. A power cut, brownout, or someone pressing the button leaves the PC off, takes the app and Steel down with it, and there is no remote way back - it needs a hand on the button. That was a reasonable deferral while someone was always near the machine; it is the single point of failure the moment nobody is.

**Deploys are now ~29s** via `npm run deploy` (compile on a dev machine, ship only `.next`, restart there). `npm run deploy:full` is the fallback that builds everything on the PC and needs nothing from a dev machine - worth knowing if the only machine that can build is far away. See ADR-016 and `remote-access.md`.

**Still open:**
1. **BIOS "Restore on AC Power Loss"** - the only thing that still requires being physically at the box, and the highest-value item if it is to be left unattended. Two minutes in UEFI setup.
2. **Buy or provision more proxy ports.** Everything else about capacity is downstream of this.
2. Re-login the checkpointed group-B accounts once a proxy exists for each.
3. **Rotate the Inngest event key** - exposed in a chat transcript. User has explicitly decided to accept this for now; the key only permits sending events into Production (no read access), and the mitigation is watching the Inngest events stream for anything unexpected. Rotate with `deploy/set-env-value.ps1 -Key INNGEST_EVENT_KEY`.
4. `.env.production.generated` on the Mac is now an exact copy of the PC's file (47 keys), pulled down as an off-box backup. Gitignored on both ends. It will drift the moment the PC's copy changes; the PC remains the source of truth and `deploy-remote.sh` will not push over it without `--push-env`.
