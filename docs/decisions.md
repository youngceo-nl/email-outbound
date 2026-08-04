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
