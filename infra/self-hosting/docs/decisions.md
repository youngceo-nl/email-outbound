# Decisions

ADR-style log, append-only. If a decision changes, add a new entry that supersedes the old one — don't rewrite history.

---

## ADR-001: Use this existing Windows 10 PC as the server, not new hardware

**Date:** 2026-08-04
**Status:** Accepted

**Context:** Primary goal is self-hosting Steel API with lowest possible electricity expenditure. This desktop (Ryzen 5 2600 + GTX 1650, see `hardware.md`) is not power-efficient hardware for 24/7 idle duty — a dedicated mini PC would likely draw much less.

**Decision:** Use this PC as-is for now rather than buying dedicated low-power hardware.

**Consequences:** Electricity savings will have to come from software/config tuning (power plan, trimming background load) rather than hardware choice. Revisit if measured idle draw turns out to make a dedicated low-power box pay for itself in a reasonable time.

---

## ADR-002: Self-host via Docker, using the WSL2 backend

**Date:** 2026-08-04
**Status:** Accepted — WSL2 (Ubuntu) and Docker Desktop (WSL2 backend) installed and confirmed working.

**Context:** Windows 10 **Home** edition doesn't include Hyper-V, so Docker Desktop's Hyper-V backend isn't an option. Docker Desktop's WSL2 backend works on Home edition. Neither WSL nor Docker is currently installed on this machine (see `hardware.md`).

**Decision:** Install WSL2 + a Linux distro, then Docker Desktop configured to use the WSL2 backend, then run steel-browser via its upstream `docker-compose.yml`.

**Consequences:** Requires enabling the WSL Windows feature and installing Docker Desktop — both are system-level changes, so confirm with the user before executing rather than doing it silently.

---

## ADR-003: Cap steel-browser container resources via a separate override file, not by editing upstream

**Date:** 2026-08-04
**Status:** Accepted

**Context:** Upstream's `docker-compose.yml` (cloned to `../steel-browser`) sets no CPU/memory limits on the `api` or `ui` services. On a 6C/12T, 16GB box that must also run the host OS, an unbounded browser-automation container is a real risk for both stability and — since idle draw scales with what's actually running — the electricity-cost goal this repo optimizes for.

**Decision:** Keep the `steel-browser` clone pristine (no edits) so it can be updated with a plain `git pull`. Resource limits live in this repo instead, at `deploy/docker-compose.override.yml` — `api`: 2 CPU / 4GB, `ui`: 0.5 CPU / 512MB, both `restart: unless-stopped` for reboot survival. Start with both compose files: `docker compose -f docker-compose.yml -f ../self-hosting-server/deploy/docker-compose.override.yml up -d`.

**Consequences:** Deploying requires remembering the two-file command (documented in `status.md`) rather than a plain `docker compose up` inside `steel-browser/`. In exchange, the limits are version-controlled in the repo that's actually meant to track this server's config, and upstream updates won't silently clobber them. Limits were picked conservatively without a real workload yet — revisit once usage patterns are known.

---

## ADR-004: Separate "Server Mode" power plan, not edits to the existing plan

**Date:** 2026-08-04
**Status:** Accepted

**Context:** The `powercfg /energy` scan (see `hardware.md`) flagged the active plan's video settings as not power-optimized ("Video playback quality bias" = performance, "When playing video" = optimize quality). This machine isn't a dedicated server, though — it's also used interactively as a PC, and the user wants to toggle between "server mode" and "PC mode" rather than commit one setting permanently.

**Decision:** Duplicated the existing **Balanced** plan (GUID `381b4222-f694-41f0-9685-ff5bb260df2e`) into a new plan, **Server Mode** (GUID `ccb9b17b-c54f-46b7-a6c1-630be4cf5a2a`), and only changed, on both AC/DC, in the Multimedia settings subgroup (`9596fb26-9850-41fd-ac3e-f7c3c00afd4b`):
- Video playback quality bias (`10778347-1370-4ee0-8bbd-33bdacaade49`) → power-saving bias (0)
- When playing video (`34c7b99f-9a6d-4b3c-8dc7-b6693b78cef4`) → Optimize power savings (2)

Original **Balanced** plan is untouched. Switch between them with `powercfg /setactive <GUID>` or Settings → Power & battery → Power Mode. **Server Mode is active now** since the box is currently running steel-browser.

**Investigated and explicitly not changed:**
- **USB Selective Suspend** — already Enabled at the plan level (both AC/DC). The 3 devices the energy report flagged as not entering Selective Suspend are HID input peripherals (a Corsair mouse, an Apple keyboard, a Trust keyboard/mouse combo) — Windows/drivers intentionally keep active input devices out of Selective Suspend to avoid wake-lag. Power impact is negligible (sub-100mW class); forcing it via Device Manager risks input responsiveness for no real gain. Left as-is even in Server Mode.
- **Wireless adapter power saving mode** — machine is on wired Ethernet, no Wi-Fi adapter in active use, so this setting is moot. Not changed.

**Consequences:** Two power plans to keep in sync manually if either needs future tuning (e.g. CPU min/max state, sleep timeout) — there's no automatic linkage between them. Whoever uses this PC interactively needs to remember to flip back to Balanced, or performance may feel off during video/media use. No real-world wattage verification yet that this actually reduces draw — the video setting is a "free to flip" change per the energy report but its wattage impact is unmeasured.

---

## ADR-005: Trim startup apps and background services not needed for server role

**Date:** 2026-08-04
**Status:** Accepted

**Context:** Follow-up to the `powercfg /energy` / `Win32_StartupCommand` audit flagged in ADR-004 and `status.md`. Login-time startup apps and always-running OEM services add idle CPU/RAM/disk overhead on a box meant to run headless 24/7 as a Docker host, independent of whether the user is logged in and using it interactively.

**Decision:**
- Disabled login autostart (via the same `StartupApproved\Run` registry flag Task Manager uses — reversible per-item without needing to re-enter original command lines) for: **Steam, Battle.net, Notion, Loom, Microsoft Edge startup boost (`MicrosoftEdgeAutoLaunch_...`)**. The apps themselves are untouched and still launchable manually.
- **NordVPN**: user asked to remove it outright rather than just disable autostart. Fully uninstalled via its own Inno Setup uninstaller (`unins000.exe /SILENT`, elevated) — this also removed the bundled **NordUpdater** product, the `nordvpn-service` and `NordUpdaterService` Windows services, and all uninstall-registry/startup traces. Verified clean: no `Program Files\NordVPN` or `NordUpdater` folders, no matching services, no startup entries.
- **Dell OEM services** (`AWCCService` — Alienware Command Center, `DellClientManagementService`, `DellTechHub`) — stopped and set to `Disabled` startup type. These are Dell management/telemetry agents with no server relevance.
- Kept running/autostarting: **OneDrive** (this repo lives under it), **Docker Desktop** (the whole point), **SecurityHealth** (Windows Defender tray), **f.lux** (harmless, low priority, left as-is).
- Explicitly held off, pending further decision: **DiagTrack** (telemetry service), **SysMain**, **WSearch** (Windows Search indexing) — flagged as candidates but not acted on, lower confidence they meaningfully affect idle draw.

**Consequences:** No wattage measurement taken before/after this change — per the "measure, don't assume" goal, the actual power impact of trimming these is unverified and likely small (mostly RAM/background-CPU, not a major idle-watt driver compared to CPU/GPU power states). Should be folded into the pending idle/loaded wattage baseline (see `status.md`) rather than measured in isolation. NordVPN is fully gone from the machine — if VPN routing is needed again later (e.g. for Steel traffic), it will need reinstalling from scratch, not just re-enabling.

---

## ADR-006: Cloudflare Tunnel + Access (Service Token) for remote reachability and auth

**Date:** 2026-08-04
**Status:** Accepted — live and verified.

**Context:** Priority shifted from efficiency to making Steel actually usable. The real driver: `email-outbound` (github.com/youngceo-nl/email-outbound), a Vercel-hosted (serverless) lead-gen pipeline, needs to reach this PC's Steel API over the internet. Two gaps blocked that: Steel was `localhost`-only, and steel-browser has **no built-in auth** (confirmed against upstream `api/.env.example` — no API key/token config exists at all). Because the caller is Vercel serverless (no persistent process to run a VPN client), Tailscale was ruled out in favor of a public HTTPS endpoint. The domain `paidinfunnel.com` was already on Cloudflare, making Cloudflare Tunnel a clean fit: no port-forwarding, no router changes, outbound-only connection from this PC.

**Decision:**
- **cloudflared installed as a Windows service** (`Cloudflared`, StartType `Automatic`, runs as LocalSystem) — starts at boot independent of any login session. Binary at `C:\Program Files (x86)\cloudflared\cloudflared.exe`.
- Tunnel is **remotely managed** (created via the Zero Trust dashboard, not `cloudflared tunnel create`) so ingress routing lives in Cloudflare's config, not a local `config.yml`. Tunnel name **`steel-api-01`**, ID `bfd0e9c9-197a-405e-bbf5-00862410a45f`. The service runs via a tunnel **token** (`cloudflared service install <token>`), stored locally at `C:\ProgramData\cloudflared\token` — not committed to this repo, not reproduced in these docs.
- **Public hostname**: `steel-api.paidinfunnel.com` → `http://localhost:3000` (the Steel **API only**). The UI (5173) and, critically, the raw **CDP port 9223** (unauthenticated full browser control) are deliberately **not** tunneled — CDP must stay local-only.
- **Auth**: a Cloudflare **Access** application (`steel-api`, app ID `e39522d6-7ca1-4246-ab8c-cc05ebe2d98c`) sits in front of that hostname with a `non_identity` policy requiring a valid **Service Token** (headers `CF-Access-Client-Id` / `CF-Access-Client-Secret`). Enforcement happens at Cloudflare's edge — requests without valid headers get a `403` before ever reaching this PC or the tunnel. Verified: no-header request → 403; request with the service token's headers → 200 with real Steel session data.
- Service token named **`email-outbound`** (token ID `b03c1aca-cd2e-46aa-91fc-441e192eb8e3`, 1-year expiry). The Client ID/Secret pair is **not stored in this repo** — it was shown once at creation and must live in a password manager until it's wired into `email-outbound` (separate future session, out of scope here — see `status.md`).
- **LAN hardening, done alongside this**: steel-browser's ports (3000/9223/5173) are still bound `0.0.0.0` at the Docker level (see "rejected alternative" below), but a Windows Firewall inbound rule (`Steel API - block non-local`) blocks all remote addresses on those ports — `localhost` is unaffected since loopback traffic bypasses Windows Filtering Platform inbound rules by design. Verified: `curl 127.0.0.1:3000` still works; blocked from other LAN devices.

**Rejected alternative — binding Docker ports to `127.0.0.1` directly:** tried first, since it's the more obvious fix. Hit a reproducible Docker Desktop **WSL2 networking bug**: binding container ports specifically to `127.0.0.1` (vs. `0.0.0.0`) intermittently fails with "address already in use" even when nothing is actually listening (confirmed via `Get-NetTCPConnection` on Windows and `netstat` inside the `docker-desktop` WSL distro — both showed nothing). Persisted even through a full Docker Desktop restart and a full `docker compose down`. Reverted to the standard `0.0.0.0` bind and used the Windows Firewall instead, which achieves the same practical outcome without fighting Docker's networking layer.

**One operational hiccup worth remembering:** the first tunnel (originally named `steel-api`, CLI-created via `tunnel create` + `tunnel route dns`) was deleted mid-setup to switch to the dashboard-managed approach. Cloudflare's dashboard then reused/collided with that same deleted tunnel ID when a same-named tunnel was recreated, producing a tunnel that showed "Healthy" locally as a Windows service but never actually registered a connection (`control stream encountered a failure`, 0 active replicas, public hostname returned Cloudflare error 1033). Fix was deleting it again and recreating under a **different name** (`steel-api-01`), which got a genuinely fresh ID and connected immediately (4 registered connections). If a dashboard-created tunnel ever silently fails to connect after a delete+recreate cycle, suspect this same collision — rename rather than debugging the same name repeatedly.

**Consequences:** Setup was done partly via the Cloudflare API using a scoped custom token (DNS edit + Access apps/policies edit + Tunnel edit, restricted to this zone/account) rather than only dashboard clicks — faster and avoided further UI friction after the tunnel-ID collision above. That token should be revoked or scoped back down now that setup is complete (recommended to the user, not verified done). No wattage impact expected or measured — this is a reachability/security change, not a power one. Reboot-survival for `cloudflared` itself is solved (real Windows service, no login needed) but Docker Desktop still needs a logged-in session — see the separate, not-yet-decided auto-login question in `status.md`.

---

## ADR-007: Enable Docker Desktop's own "start on sign-in" setting

**Date:** 2026-08-04
**Status:** Accepted — changed and verified across a Docker Desktop restart; not yet verified across a full Windows reboot.

**Context:** With Windows auto-login now enabled (see `status.md`), the first real unattended-restart test still left Docker Desktop not running 7+ minutes after boot — meaning both Steel containers and the public endpoint stayed down until someone logged in and started it manually. Investigation found a Windows `Run` registry key (`HKCU\...\Run\Docker Desktop`) pointing at the executable, which looked like it should auto-launch — but Docker Desktop's own preference file, `%APPDATA%\Docker\settings-store.json`, had `"AutoStart": false`. Docker Desktop appears to check this internal setting on launch and no-op (or exit) if it's off, so the leftover registry entry alone doesn't do anything; it's not the actual mechanism gating autostart.

**Decision:** Stopped Docker Desktop (`docker desktop stop`), edited `AutoStart` to `true` directly in `settings-store.json`, restarted (`docker desktop start`). Confirmed the value persisted through the restart. Normally this is a UI toggle (Settings → General → "Start Docker Desktop when you sign in") — edited the file directly instead since Docker Desktop wasn't running to click through the UI.

**Consequences:** This should let Docker Desktop (and thus both Steel containers, via their existing `restart: unless-stopped`) come back automatically after future reboots, closing the gap auto-login alone didn't cover. Not yet confirmed across an actual full Windows reboot — only a Docker Desktop process stop/start — so treat as fixed-but-unconfirmed until the next real reboot. Separately, on this same test the API container (`steel-browser-api-1`) crashed on its very first cold-start attempt after Docker Desktop came up (Puppeteer/CDP `TargetCloseError`, likely resource contention while Docker's backend was still settling) and did not auto-retry within ~48s despite the `unless-stopped` policy; a manual `docker start` succeeded immediately after. Not treated as a settings problem — noted in `status.md` as something to watch on the next reboot test, not fixed here.

---

## ADR-008: Fix Steel's advertised `DOMAIN` + add Cloudflare Access headers in `email-outbound`

**Date:** 2026-08-04
**Status:** Accepted — deploy-side fix verified live; `email-outbound` code fix applied but not yet tested end-to-end (blocked on the Access Service Token secret, see `status.md`).

**Context:** User decided to actually exercise the `email-outbound` → Steel integration (see ADR-006) rather than leave it at "reachable in theory." Cloned `email-outbound` locally and traced its Steel call path (`lib/instagram/steel-acquisition.ts` → `scripts/experiments/playwright-instagram-complete.ts` → `scripts/experiments/browser-backend.ts`). Found three gaps that would each independently break a real call from anywhere off this PC:
1. `browser-backend.ts` constructed the `steel-sdk` client with only `steelAPIKey` / `baseURL` — no Cloudflare Access headers, so the session-create call would get `403`'d at Cloudflare's edge before reaching Steel.
2. Even with #1 fixed, `chromium.connectOverCDP(session.websocketUrl)` was called with no headers either — the live browser-control WebSocket would also get blocked by Access, separately from the REST call.
3. On this PC's side: the running `steel-browser-api-1` container still had the upstream-default `DOMAIN=localhost:3000` / `CDP_DOMAIN=localhost:9223` (confirmed via `docker exec ... env`) — meaning `session.websocketUrl`, the URL Playwright actually connects to, came back as `ws://localhost:3000/...` regardless of headers. Meaningless to a process running on Vercel.

Also confirmed while investigating: `session.websocketUrl` is built from `DOMAIN` + the **main API port** (3000, via `getBaseUrl("ws")` in `steel-browser/api/src/utils/url.ts`), not the separate CDP port 9223 (`CDP_DOMAIN`, used only for the direct devtools/debugger URL, `getDebuggerBase()` in `cdp.service.ts`). So the browser-control path already goes through the same port ADR-006 tunneled — fixing this did **not** require exposing 9223 publicly, which ADR-006 deliberately kept local-only.

**Decision:**
- **This repo** (`deploy/docker-compose.override.yml`): added `DOMAIN=steel-api.paidinfunnel.com` and `USE_SSL=true` to the `api` service's environment. `USE_SSL` only changes the protocol prefix Steel puts in the URLs it hands back (`http`→`https`, `ws`→`wss`) — the container still listens on plain HTTP internally, since TLS is terminated by Cloudflare, not here. Verified live: a real session-create call now returns `"websocketUrl":"wss://steel-api.paidinfunnel.com/"` instead of a `localhost` address.
- **`email-outbound`** (`scripts/experiments/browser-backend.ts`): added optional `cfAccessClientId` / `cfAccessClientSecret` to `BackendOptions`, falling back to `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` env vars — same tier as the existing `steelApiKey`/`STEEL_API_KEY` fallback. When both are present, they're sent as `defaultHeaders` on the `steel-sdk` client (session-create call) **and** as the `headers` option on `chromium.connectOverCDP` (confirmed Playwright has supported a `headers` param there since v1.11; the installed version is 1.60). Deliberately did **not** thread these through the full options chain up to `acquireInstagramEvidence` / `app_settings` the way `steel_api_key`/`steel_base_url` are — the CLI harness at the bottom of `playwright-instagram-complete.ts` doesn't pass those explicitly either, relying entirely on the same env-var fallback inside `openSteelSession`, so fixing only that one file is sufficient for every current caller (CLI harness, the inngest function, and eventually Vercel) without touching four files or adding new DB schema for a decision nobody asked for yet.

**Consequences:** The deploy-side fix (#3) is proven live right now. The code fix (#1, #2) is applied but **not yet tested end-to-end** — the Access Service Token secret for `email-outbound` was, per ADR-006, shown once at creation and never saved anywhere, so there is currently no way to actually populate `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` and prove the fix works until that's sourced from a password manager or rotated via the Cloudflare dashboard. If `email-outbound` later grows a settings UI / app_settings row for shared team credentials (it already has this pattern for `steel_api_key`/`steel_base_url`), the same treatment could be extended to the Access token pair — not done here, flagged for whoever picks that up.

---

## ADR-009: Override the tunnel's HTTP Host Header so Chrome accepts the CDP connection

**Date:** 2026-08-04
**Status:** Accepted — fixed and verified live with a real end-to-end acquisition run.

**Context:** After ADR-008's fixes (Access headers on both the session-create call and the CDP connection, `DOMAIN` fixed on the container), a real test run through `email-outbound`'s `browser-backend.ts` still failed — but with a new error, one level deeper: `chromium.connectOverCDP` got a `500` from Chrome itself: *"Host header is specified and is not an IP address or localhost."*

Root cause traced into `steel-browser`'s own code (`api/src/services/cdp/cdp.service.ts:1136`, `proxyWebSocket()`): it proxies the CDP WebSocket to Chrome's internal debugging port using the `http-proxy` library's `.ws()` method with only `{ target: this.wsEndpoint }` — no `changeOrigin`. That means the original inbound `Host` header (`steel-api.paidinfunnel.com`, preserved end-to-end by Cloudflare's edge and by `cloudflared`'s default origin-request behavior) gets forwarded unchanged all the way to Chrome's raw CDP listener. Chrome has a built-in anti-DNS-rebinding check that rejects any CDP connection whose `Host` header isn't `localhost` or a bare IP — this is a Chrome security feature, unrelated to Steel or Cloudflare Access, and it fires independently of whether auth already passed.

**Decision:** Fixed at the Cloudflare Tunnel layer instead of patching `steel-browser` (kept pristine for `git pull`, per earlier entries). Used the Cloudflare API (`PUT /accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations`) to add an `originRequest.httpHostHeader` override to the `steel-api.paidinfunnel.com` ingress rule, forcing `cloudflared` to send `Host: localhost:3000` to the local origin regardless of the public hostname the client actually used. Tunnel config bumped `bfd0e9c9-197a-405e-bbf5-00862410a45f` from version 1 to version 2. **Verified immediately after** with a real run of `email-outbound`'s CLI harness (`scripts/experiments/playwright-instagram-complete.ts --steel`, no Instagram login cookie so no real account/proxy at risk): Steel session created, Chrome accepted the CDP connection, Playwright drove real browser automation against a live (logged-out) Instagram profile page through the full public path, and the session closed cleanly. This proves ADR-006 (tunnel+Access), ADR-008 (headers + DOMAIN), and this fix all work together end-to-end.

**How this token was obtained/handled:** user created a fresh Cloudflare API token scoped to Account → Cloudflare Tunnel: Edit only (narrower than the original setup token in ADR-006, which also had DNS + Access edit). Cloudflare's token UI cannot scope "Tunnel: Edit" down to a single tunnel — it's account-wide for all tunnels on the account. The token was written to a file in the assistant's session-scratchpad directory (outside any git repo, not `self-hosting-server/.env.local` — that file wouldn't actually have been excluded by this repo's `.gitignore`, which only matches `.env`/`*.env`, not `.env.local`), used for the one API call above, and should be revoked the same way as the original setup token once confirmed no longer needed — **not yet done as of this entry**, see `status.md`.

**Consequences:** The full public path (Vercel-shaped caller → Cloudflare Access → tunnel → Steel → real Chromium → real webpage) is now proven working, not just theorized. Two Cloudflare API tokens are now outstanding and unrevoked: the original broad setup token from ADR-006, and this narrower Tunnel-Edit token — both need cleanup. A real authenticated Instagram acquisition (with a login cookie / pinned proxy / real account) still hasn't been tested — this run deliberately avoided that to keep the test low-risk.

---

## ADR-010: Re-applied ADR-008's Cloudflare Access header fix (it was never actually committed) + added a Steel-driven Instagram login/onboarding script

**Date:** 2026-08-04
**Status:** Accepted — code changes made and type-checked; not yet run live (blocked on credentials, see below).

**Context:** Picking this effort back up to make the Steel workflow usable, starting from the idea of having Steel itself perform the Instagram login (a human completes it through Steel's live session viewer, rather than a local headed browser or a fully-scripted login) so a session cookie can be captured without ever handling the account password in code. Before building that, checked whether ADR-008's `email-outbound` code fix (Cloudflare Access headers on `browser-backend.ts`'s Steel calls) actually exists in the repo, since it's a hard prerequisite for any Steel call to reach past Cloudflare's edge. It did not: `git log` on `scripts/experiments/browser-backend.ts` has no such commit, the working tree was clean and in sync with `origin/main`, and a repo-wide grep for `CF_ACCESS`/`cfAccessClient` returned nothing. The fix described in ADR-008 and exercised by the "verified end-to-end" run in `status.md` was apparently made to local files during that session but never committed/pushed, so the current `email-outbound` `main` branch has never actually had it.

**Decision:**
- Re-applied the ADR-008 fix in `email-outbound/scripts/experiments/browser-backend.ts`: `BackendOptions` gained `cfAccessClientId`/`cfAccessClientSecret`, falling back to `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET` env vars, sent as `defaultHeaders` on the `steel-sdk` client and as `headers` on `chromium.connectOverCDP` — same shape as before, just actually landed this time. `npx tsc --noEmit` (both `tsconfig.scripts.json` and the full project) is clean.
- Added `email-outbound/scripts/onboard-instagram-account.ts`: a production script (not under `scripts/experiments/`, since unlike those it does write to shared settings) that opens a Steel session on this PC's self-hosted instance with no cookie yet, prints Steel's live session-viewer URL (`getBaseUrl()` in `steel-browser`, i.e. the same `DOMAIN`-based, already-tunneled URL `debugUrl`/`sessionViewerUrl` both resolve to — confirmed by reading `steel-browser/api/src/utils/url.ts` and `session.service.ts`), waits for a `sessionid` cookie to appear (human completes the real login/2FA on that URL), then writes the captured cookie into `app_settings.instagram_accounts` (new or existing account by label) gated behind `--apply`, with the same optimistic-concurrency (`eq("updated_at", ...)`) pattern used by `configure-production-identities.ts` and `quarantine.ts`.
- Deliberately did not thread `cfAccessClientId`/`cfAccessClientSecret` through the full options chain (`playwright-instagram-complete.ts`, `steel-acquisition.ts`) — same reasoning ADR-008 already gave: every current caller, including the new script, goes through `openSteelSession` and picks the env vars up automatically.
- Deliberately did not capture or store the account's password/TOTP — the human types it directly into Steel's live view, so the script never sees it. Tradeoff: the resulting account is not eligible for the existing (currently cron-disabled) automated cookie-refresh path in `inngest/functions/refresh-ig-cookies.ts`, which needs a stored password. Re-running this script by hand is the refresh path for Steel-onboarded accounts.

**Also found, not yet fixed:** `email-outbound`'s `node_modules` was missing entirely from this clone (despite `status.md` recording a successful `npm install` earlier the same day) — re-ran `npm install` (875 packages, matches the earlier count) to type-check the above. No `.env.local` exists in the clone at all, so none of `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STEEL_BASE_URL`, `STEEL_API_KEY`, or `CF_ACCESS_CLIENT_ID`/`SECRET` are currently set locally — nothing in this repo can actually run yet, only type-check.

**Consequences:** The Cloudflare Access gap that would have silently 403'd every Steel call is closed again, this time confirmed by reading the actual file rather than trusting the prior doc entry. Nothing has been run live yet — that needs, at minimum, the Supabase service role key and the `email-outbound` Cloudflare Access Service Token secret (see `status.md`: shown once at creation, never saved, likely needs rotating) sourced into the environment before either the existing acquisition path or this new onboarding script can be exercised for real. Next real test should be `onboard-instagram-account.ts` against a real (or disposable/burner) Instagram account once those credentials are in hand.

---

## ADR-011: Two more real bugs found while verifying ADR-010 live, both fixed; first fully-authenticated run proven

**Date:** 2026-08-05
**Status:** Accepted — fixed and verified live with a real authenticated acquisition run.

**Context:** User rotated the Cloudflare Access Service Token and sourced the Supabase service role key (see ADR-010), enabling the first real test of the credential chain. A throwaway smoke test (Supabase read + Steel session-create) confirmed both credentials work, but surfaced two further problems, neither of which were about the credentials themselves:

1. **`browser-backend.ts`'s live-viewer URL picked the wrong field.** `debugUrl: session.sessionViewerUrl ?? session.debugUrl ?? null` preferred `sessionViewerUrl`. Reading `steel-browser/api/src/services/session.service.ts` showed `sessionViewerUrl` is always `getBaseUrl()` — a hardcoded default, identical on every session, not session-specific — while `debugUrl` (`getUrl("v1/sessions/debug")`) is the real thing: steel-browser's own route schema describes it as returning "an HTML page with a live debugger view of the session." `sessionViewerUrl` is meaningful on Steel Cloud (a hosted `app.steel.dev` page); the self-hosted image never implements a real one, it just inherits the placeholder default. The bug had been silently there since `browser-backend.ts` was first written — harmless for the existing headless acquisition pipeline (nobody looks at the URL), but would have handed a dead link to any human trying to actually use Steel's live view, which is the entire point of the new onboarding script.
2. **Shared `app_settings.steel_base_url` in Supabase was stale**, set to `http://localhost:3555` instead of `https://steel-api.paidinfunnel.com`. Found because the onboarding script (which reads `settings.steel_base_url` ahead of the env var, matching the codebase's own DB-over-env convention) failed with a connection error. This value is read by every caller going through `openSteelSession`'s settings-first fallback — including, presumably, the real Vercel deployment — so this was silently going to break Steel connectivity for anyone relying on shared settings rather than a local env override, independent of every other fix in this session.

**Decision:**
- Swapped the priority in `browser-backend.ts` to `session.debugUrl ?? session.sessionViewerUrl ?? null`, with a comment explaining why (self-hosted vs. Cloud). Verified with a raw `curl` through Cloudflare Access: `https://steel-api.paidinfunnel.com/v1/sessions/debug` → `200`, `text/html`, ~67KB, titled "Steel Session Player." This specific page had never been confirmed reachable over the tunnel before — only the raw CDP WebSocket had (ADR-009).
- Corrected `app_settings.steel_base_url` directly in Supabase to `https://steel-api.paidinfunnel.com`.
- Proved the fix chain end-to-end: ran `runPlaywrightInstagramComplete` (backend `steel`) using an **already-authenticated** existing account (`masakonjoku61`, group C, proxy `disp.oxylabs.io:8001`, real stored cookie — no new login performed) against a real public profile (`@natgeo`). Result: `authenticated: true`, `challenge: none`, zero errors, real captured data (268,874,261 followers). This is the first real fully-authenticated run through the complete stack (self-hosted Steel → Cloudflare Tunnel → Access → real Chromium → real logged-in Instagram session) — everything before this (ADR-009's run, and today's initial smoke test) was either logged-out or credential-only.
- **Did not** run `onboard-instagram-account.ts` itself (the new-account human-login capture path) — that was deliberately deferred. The queued test candidate, `livelypageant8`, is a genuinely fresh/never-onboarded account but has no proxy, and all 5 Oxylabs dedicated ports are already claimed by the other group-C accounts. Reusing one would link two accounts to the same exit IP, which `assign-oxylabs-proxies.ts` already refuses to do for exactly this reason. User explicitly chose not to wait on provisioning a 6th port right now.

**Consequences:** The Steel integration is now proven live with real authentication, not just theorized or logged-out-tested — a meaningfully stronger claim than any prior entry in this log. The stale `steel_base_url` fix in particular may have been silently affecting the production Vercel deployment this whole time; worth confirming the deployed app is now picking up the corrected value (it reads the same shared settings row, so no redeploy should be needed, but not separately verified from Vercel's side). `onboard-instagram-account.ts` remains unverified in practice — next real test of *that specific script* still needs a spare proxy for `livelypageant8` (or another genuinely-fresh account).

---

## ADR-012: Tailscale for admin access from the Mac (this does not reverse ADR-006's rejection of it)

**Date:** 2026-08-05
**Status:** Accepted — decided and documented; setup not yet performed on either machine.

**Context:** Deploying `email-outbound` to this box was a hand-run sequence: copy `.env.production` over by some out-of-band means, edit it in place, `git pull`, `docker compose up --build`, then open the site and — when it failed with a Next.js digest and nothing else — ask whoever was at the PC to run `docker logs` and paste the output back. Every step needed a human physically at the machine, and the slowest part of the loop was not the build but the round-trip for the error message.

ADR-006 rejected Tailscale, so adopting it now needs an explicit note about why that is not a contradiction. **The rejection was scoped to a specific caller and still holds for it.** ADR-006's problem was Vercel serverless functions reaching Steel: no persistent process exists in a serverless invocation to run a VPN client, which is why a public HTTPS endpoint behind Cloudflare Access was the right answer there and remains so. This ADR is about a *different* caller — a Mac, which is an ordinary always-on machine that can trivially run a VPN client. The two decisions do not overlap: app-to-Steel traffic continues to go over the Cloudflare Tunnel exactly as before, and nothing about ADR-006's architecture changes.

**Decision:**
- **Tailscale on the Mac and the PC**, plus Windows OpenSSH Server, giving `ssh`/`scp` to the box over a private WireGuard mesh. Setup steps in `remote-access.md`.
- **Rejected: SSH over the existing Cloudflare Tunnel.** Genuinely viable, and appealing because it reuses the cloudflared service and Zero Trust config already on the box — no new vendor, no second agent, no extra idle power draw. Rejected on cost/benefit: it needs a new tunnel ingress, an Access application and policy, and a `cloudflared access ssh` ProxyCommand on the Mac, *and still requires OpenSSH Server on Windows anyway*, so it is strictly more configuration for the same result. It also makes `scp` awkward, and pushing `.env.production` is half the point. Worth revisiting if the Tailscale agent's power cost ever measures as non-trivial.
- **Rejected for now: RDP or Parsec** alongside SSH. Acknowledged gap — `status.md` records two failures (Docker Desktop's `AutoStart` setting, the cold-start API container crash) that were diagnosed and fixed through the Docker Desktop GUI, and SSH would not have helped with either. Deferred rather than dismissed: SSH covers the deploy loop, which is the actual recurring pain, and a desktop channel is more setup and more exposed surface for a case that has come up twice.
- **SSH restricted to the Tailscale CGNAT range** (`100.64.0.0/10`) at the Windows firewall, matching the existing treatment of Steel's ports — installing OpenSSH Server opens port 22 on all profiles by default, including the LAN, which is not wanted.

**Consequences:** Accepts a small always-on agent on a box whose stated primary constraint is minimizing 24/7 power draw. Judged worth it: the deploy loop currently costs a human trip to the PC, and the alternative (Cloudflare Access SSH) avoids the agent but not the complexity. Not yet measured against the 61W idle baseline — if the next wattage reading moves, this is a candidate cause. Also note Tailscale is a new third-party dependency in the path to administering the machine; if it is down or an account lapses, access falls back to physically using the PC, which is exactly today's situation and so not a regression.

---

## ADR-013: Deploy via a checked-in script, not documented commands — prompted by a build-arg bug that made the app unbootable

**Date:** 2026-08-05
**Status:** Accepted — scripts written; not yet executed against the PC.

**Context:** The app was failing on `app.paidinfunnel.com/leads` with a Next.js digest-only 500. Reading the deploy path rather than the logs found a cause that the documented command could not avoid:

`deploy/docker-compose.app.yml` passes `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as **build args** via `${...}` interpolation — correctly, because `Dockerfile` notes that `NEXT_PUBLIC_*` values are baked into the bundle at build time and cannot be supplied at runtime. But Compose resolves `${...}` from the shell environment or from a `.env` in the **compose file's own directory** (`infra/self-hosting/deploy/`). It does *not* read the `env_file:` entry for interpolation — that is runtime-only, and it is the only place `.env.production` is referenced. Neither source exists on the PC, so the documented `docker compose -f infra/self-hosting/deploy/docker-compose.app.yml up -d --build` builds with both values as empty strings. Next then inlines a blank Supabase URL, and `middleware.ts` — which calls `createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, ...)` and runs on effectively every route — throws on every request. Compose does emit a warning for each unset variable, but it scrolls past in build output and the resulting failure surfaces in the browser as a digest hash with no other detail.

This is a failure the correct manual command cannot prevent, which is the argument for a script over a documented procedure.

**Decision:**
- **`deploy/deploy.ps1`** (runs on the PC): `git pull --ff-only`, validate `.env.production`, build, health-check, and dump `docker logs --tail 80` automatically on any failure. Specifics worth recording:
  - Passes `--env-file` explicitly, which is the actual fix for the above.
  - Treats every uncommented key in `.env.production.example` as required, so the required-key list lives in the template rather than duplicated in the script.
  - Rejects any value matching `<...>` anywhere in the file. This is aimed squarely at `INNGEST_EVENT_KEY`: `inngest/client.ts` decides dev-vs-cloud on whether that variable is non-empty, so a leftover placeholder is *worse* than an absent one — it silently points the app at Inngest Cloud with a garbage key.
  - Health-checks `/login`, not `/leads`. `middleware.ts` redirects unauthenticated requests, so `/leads` returns 307 even when healthy; `/login` returns a real 200 and still executes middleware, so it fails loudly if the Supabase env is wrong.
- **`deploy/deploy-remote.sh`** (runs on the Mac, needs ADR-012): pushes `.env.production.generated` to the box as `.env.production`, then runs `deploy.ps1` over SSH. This closes the loop — `.env.production` is gitignored and so can never arrive via `git pull`, which is why copying it was a manual step in the first place.
- **`.env.production.example` checked in**, with `.gitignore` amended to except it (`.env*` was swallowing it; only `.env.local.example` had been excepted). No values in it, only key names.
- **Recorded separately, not fixed here: there is no self-hosted Inngest on this box.** The env template shipped `INNGEST_EVENT_KEY=<from your self-hosted inngest>`, but no Inngest service exists in either compose file and nothing in `status.md` ever deployed one; `README.md` still describes the keys as coming from Inngest Cloud. Both lines are commented out in the template with an explanation. Consequence: background jobs (crawl, scoring, acquisition fan-out) do not run on this deployment at all. Page loads are unaffected. Deciding what to actually do about Inngest is deferred and is not a deploy problem.

**Consequences:** The digest-only-error debugging loop is closed: a failed deploy prints the real error at the Mac without anyone touching the PC. The `--env-file` finding means any previous successful-looking build on this box likely produced a broken image, so the first run of this script is also the first build expected to actually work. Neither script has been executed yet — `deploy.ps1` in particular has not been run on Windows and PowerShell was not available to even syntax-check it locally, so treat the first run as a test of the script as much as of the deploy. Both must be committed and pushed before `deploy.ps1` can reach the PC via `git pull`, so the very first deploy has a bootstrap step.

---

## ADR-014: ADR-013's diagnosis was wrong — the app boots fine; the real fault is an Inngest Cloud branch-environment key

**Date:** 2026-08-05
**Status:** Accepted — supersedes ADR-013's *diagnosis*. ADR-013's code changes stand; its root-cause claim does not.

**Context:** ADR-013 concluded, by reading the deploy path rather than the box, that the `app.paidinfunnel.com` failure was caused by Compose interpolating the `NEXT_PUBLIC_*` build args to empty strings, baking a blank Supabase URL into the bundle and making `middleware.ts` throw on every request. Once SSH access existed (ADR-012), that was checked directly and **is not what is happening**:

- `http://localhost:3417/login` returns `200` and `/leads` returns `307` — the correct unauthenticated redirect. Both are healthy responses.
- `supabase.co` is present in the built `.next/server/middleware.js`, so the build did receive real values.
- The container's log contains exactly **one** error across its entire lifetime: `Inngest API Error: 400 Branch environment name is required`, digest `2497154375` — the same digest the browser was showing.
- `app/(dashboard)/leads/page.tsx` imports no Inngest client at all; it reads Supabase directly. Rendering `/leads` cannot produce that error. It came from a user action that dispatches events, and fired once, not per request.

**What ADR-013 got right, and why the fix stays:** there is no `.env` in `infra/self-hosting/deploy/`, so Compose genuinely has no interpolation source for those build args. The image that exists was built by a shell that happened to have the variables exported. That is a real latent bug — the next build from a clean shell would produce exactly the broken image ADR-013 described — so passing `--env-file` remains correct. It was a real defect found by the wrong reasoning, not the failure being investigated.

**The actual fault:** `INNGEST_EVENT_KEY` on the PC is a real **Inngest Cloud** key belonging to a *branch* environment, and `INNGEST_ENV` is unset. Inngest derives that from `VERCEL_GIT_COMMIT_REF` on Vercel; a self-hosted container has no equivalent, so the SDK sends no environment name and Cloud rejects the send. This also corrects ADR-013's framing: it is true that **no self-hosted Inngest exists on this box** (no container in either compose file), but the deployment is not therefore Inngest-less — it points at Inngest Cloud, and the env template's `<from your self-hosted inngest>` placeholder was describing something that was never the plan. Cloud can reach the app: `GET` and `PUT` to `https://app.paidinfunnel.com/api/inngest` both return `200`, so Cloudflare Access is not blocking the sync path.

**Decision:**
- Use **Production** Inngest Cloud keys for this deployment rather than setting `INNGEST_ENV` to a branch name. Setting `INNGEST_ENV` would work, but it would file a production self-host's runs under a branch environment, which is wrong on its own terms.
- **`deploy-remote.sh` no longer pushes `.env.production` by default** — it is now opt-in via `--push-env`. This was a genuine near-miss: the PC's `.env.production` holds `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `INNGEST_DEV` and `STEEL_API_KEY`, none of which exist in the Mac's `.env.production.generated`. Running the script as originally written would have silently destroyed all four. The PC's copy is the source of truth; the Mac's is a stale subset. When `--push-env` is given, the script now diffs key *names* (never values, never pulling the remote file down), refuses if the PC has keys the local file lacks unless `--force`, and takes a timestamped backup on the box first.
- **A credential was exposed** reading the container's environment during this investigation: the Inngest event key was printed in full to a terminal. It needs rotating regardless of the branch-environment problem. Subsequent env inspection was done with values masked to key-name-and-length only.

**Consequences:** The app was substantially working the whole time — the "fix the app" task it was filed under was based on a misreading of a digest-only error page, and so was ADR-013. What is actually broken is narrower: every Inngest-dispatching action (crawl start, scoring, acquisition fan-out, bulk lead operations) fails at the send. Page loads, Supabase reads, and the Steel path are unaffected. The general lesson, and the reason ADR-012 was worth doing first: two successive root-cause claims were made by reading code, and the first thing that actually looked at the machine overturned both.

---

## ADR-015: `docker build` cannot run over SSH here - run it in the interactive session

**Date:** 2026-08-05
**Status:** Accepted - implemented and verified with a real build and container replacement.

**Context:** With SSH working (ADR-012), the first real run of `deploy.ps1` failed, and so did the three runs after it. Each failure was a different real defect, and none was visible from reading the scripts:

1. **Mixed path separators.** `deploy-remote.sh` joined a forward-slash `PC_REPO` with backslash segments; PowerShell could not find `deploy.ps1`.
2. **`powershell.exe` exits 0 when `-File` points at a missing script.** The wrapper reported a successful deploy of nothing. Worse, the health check then went green - a failed build leaves the *previous* container running and serving, so "the site is up" is not evidence that anything shipped. The exit code is now checked *before* the health check, and the health check is explicitly the second opinion rather than the only one.
3. **The self-updating script trap.** `deploy.ps1` ran `git pull` as its first step, including pulling changes to itself - but PowerShell parses a script into memory before executing, so the run that fetched a fix always executed the pre-fix copy. This cost a full debugging cycle chasing a fix that was on disk and provably not running. `deploy-remote.sh` now pulls over plain SSH *before* invoking the script.
4. **The real blocker: Docker Desktop's credential helper.** Every build died before reading the Dockerfile with `error getting credentials - A specified logon session does not exist`.

**On (4), the cause is the logon type, not any Docker setting.** Windows OpenSSH with public-key auth produces a *network* logon token. Docker Desktop's credential helper reaches for DPAPI-protected user credentials, which such a token cannot access. Four fixes were tried and all four fail identically: removing `credsStore` from `~/.docker/config.json`, setting it to `""`, pointing `DOCKER_CONFIG` at a clean config directory, and passing `docker --config`. Note that removing `credsStore` is actively *not* enough on Windows - the CLI then defaults to `wincred`, which hits the same wall. Commands that never consult the credential store (`docker ps`, `exec`, `logs`, and `compose up` *without* `--build`) work fine over SSH, which is why everything before this point worked.

**Decision:** `run-interactive.ps1` registers a scheduled task with `/IT`, runs it in the desktop session that is already logged on (auto-login, ADR-007), relays its output while it runs, and returns its exit code. `deploy-remote.sh` invokes `deploy.ps1` through it. Running `deploy.ps1` directly at the PC is unaffected and needs no wrapper. Rejected: switching SSH to password auth, which does produce a credential-capable token but requires storing a password to stay unattended - strictly worse than a scheduled task.

**Separately, and worth recording because the failure mode is invisible: a helper script written during this session corrupted two live credentials.** `set-inngest-keys.ps1` read its hidden prompt with `[Marshal]::PtrToStringAuto` on a BSTR. That marshals as ANSI and stops at the first null byte of the UTF-16 buffer, so it returns only the **first character** of whatever was typed - then reports success. Both Inngest keys were written as 1-character values, and it was only caught because a post-deploy event send returned 404 instead of 200. Recovered from the timestamped backup the script itself had taken, which is the only reason this was a five-minute fix. Replaced by `set-env-value.ps1`, which uses `PtrToStringBSTR`, refuses to write anything shorter than 8 characters, and prints the written length so a truncation cannot pass silently.

**Consequences:** A deploy is now one command from the Mac and the first fully verified one has run end to end: build from freshly pulled source, container replaced, health check passed locally and from the Mac, event send `200`, app re-registered with Inngest Production. The general lesson is the same as ADR-014's and sharper: every one of these five defects was invisible to reading and obvious on execution. Scripts written but not run should be treated as unverified, and the status docs should say so explicitly. Also note the deploy path now depends on the PC being *logged in*, not merely powered on - a reboot that stops at the login screen breaks deploys, not just Docker. Auto-login already covers this, so it is a dependency to remember rather than a new risk.

---

## ADR-016: Compile on a dev machine and ship only `.next` - 240s deploys became 29s

**Date:** 2026-08-06
**Status:** Accepted - live in production on 3417, validated side by side against the previous container before the switch.

**Context:** A deploy took ~240s, and the question "why" had never been measured. BuildKit step timings answered it immediately: `npm ci` was already layer-cached at 0s, image export was 4.5s, every other step was under a second, and `next build` was **142.6s**. The container machinery was ~10s of the total. Two further facts came out of the same measurement: Docker discarded `.next/cache` on every run, so every deploy was a cold full compile of the whole app; and lint was still running 77s into the build.

**Decision:**
- **Compile on the developer machine, not the server.** The PC (Ryzen 5 2600, 2018) takes 81s warm; a dev Mac takes ~22s. Only `.next` is shipped.
- **Ship `.next`, never `node_modules`.** This is the load-bearing constraint. `sharp`, used by `next/image` at runtime, has a platform-native binary, so shipping `.next/standalone` from macOS arm64 would put `@img/sharp-darwin-arm64` into a linux/amd64 container. The runtime image keeps its own linux `node_modules` (installed there by npm) and runs `next start` against the shipped build output, which is portable JavaScript. Excluding `.next/standalone` also cut the payload from ~100MB to ~24MB - 94MB of it was that unused bundle - taking transfer from 21s to 4s. The exclusion is a correctness guarantee as much as a speed one.
- **`NEXT_PUBLIC_*` are read from `.env.production.generated`**, the copy of the server's own env, never from the developer's `.env.local`. They are inlined at build time, and baking dev values into a production bundle is exactly the failure ADR-013/014 chased.
- **Type-checking moved rather than dropped:** `predeploy` runs `tsc --noEmit` (5.6s locally) so a deploy still cannot carry a type error. **Linting is genuinely off**, and was protecting nothing - `eslint .` reports ~1000 errors because it lints generated `.next` output rather than source, so it failed regardless of code quality. Worth fixing that ignore config and restoring it to `predeploy`.
- **Both paths kept.** `deploy:full` still builds everything on the PC and needs nothing from a dev machine. Both bind 3417 and each stops the other's container first, so whichever is run wins instead of failing on a port conflict; the previous container is stopped rather than removed, making rollback `docker start email-outbound`.

**Validated before the switch, not after:** both containers ran side by side and returned byte-identical responses on `/login`, `/leads`, `/api/inngest`, a static asset and `/_next/image`. The last row is the one that mattered - identical bytes mean linux `sharp` did real work in the runtime image - so the platform-native concern was closed by measurement rather than argument. Image optimization was re-confirmed through the public tunnel after the flip.

**Result:** 240s to **29s** (22s compile, 4s transfer, 2s restart+health), an 8x improvement.

**Consequences:** Deploys now depend on a machine that can compile, which is the real cost of the speed; `deploy:full` exists precisely for when that is not available. The runtime image needs rebuilding only when `package-lock.json` changes, and `deploy-fast.sh` does that on demand through `run-interactive.ps1` (a Docker build still cannot run over SSH here - ADR-015). Getting materially below ~29s would need a faster build machine or fewer statically-generated pages; the remaining time is real compile work, not overhead.
