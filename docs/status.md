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
