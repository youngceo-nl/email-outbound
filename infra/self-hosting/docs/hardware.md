# Hardware baseline

Measured 2026-08-04 on the machine this repo lives on.

| Component | Spec | Power note |
|---|---|---|
| CPU | AMD Ryzen 5 2600, 6C/12T, 3.4GHz base | ~65W TDP — not a low-power part; has no integrated GPU |
| RAM | 16 GB | negligible |
| GPU | NVIDIA GeForce GTX 1650 | ~75W TDP class; required for display output since CPU has no iGPU; not needed by Steel/Chrome itself in headless use |
| Storage | Kingston SA2000M8 500GB NVMe SSD | negligible |
| OS | Windows 10 Home, build 19045 (22H2) | Home edition — no Hyper-V, so Docker Desktop must use the WSL2 backend, not Hyper-V |
| Chassis | Custom-built desktop tower (generic "System manufacturer/Product Name" — likely a self-built or white-label board) | desktop-class PSU, not optimized for idle efficiency the way laptops/NUCs are |

## What this means

This is desktop gaming-class hardware, not power-efficient server hardware. A Ryzen 5 2600 + GTX 1650 combination will likely idle well above what a mini PC (e.g. Intel N100, ~6W idle) or Raspberry Pi would draw.

## First real wattage reading (2026-08-04, unverified/general)

**120W / 514mA / 225V**, via LSC Smart Connect smart plug, PC tower only (monitor/peripherals on a separate outlet).

This was a **general/unverified reading**, not taken under the controlled idle-vs-load protocol — Server Mode active status and steel-browser load state at the moment of reading weren't confirmed. Superseded by the controlled baseline below; kept here for the record since the gap between the two is itself informative (see note below).

## Controlled idle/load baseline (2026-08-04)

Taken under confirmed conditions: **Server Mode** power plan active (`powercfg /getactivescheme` verified), Docker Desktop running, `steel-browser-api-1`/`steel-browser-ui-1` containers up, tower-only on the LSC smart plug (monitor intentionally excluded — it's off during unattended server operation, not part of the 24/7 draw). Also taken *after* the startup-apps/services trim in `decisions.md` ADR-005 (Steam/Battle.net/Notion/Loom/Edge-boost disabled, NordVPN removed, Dell OEM services disabled).

| State | Reading |
|---|---|
| **Idle** (containers up, no active session, settled ~1-2 min) | **61W / 349mA / 225.4V** |
| **Loaded** (one live Steel browser session, one page navigated via `/v1/scrape`) | **65W / 377mA / 228.3V** |

**Delta: ~4W** for a single lightweight headless Chrome session — small, consistent with the `api` container's 2 CPU/4GB cap (`deploy/docker-compose.override.yml`) and a single-page load being a light workload. Not yet tested: multiple concurrent sessions, or a heavier page/longer session — the per-session marginal cost at higher concurrency is still unknown.

**Note on the gap vs. the earlier 120W reading**: idle baseline came in ~59W lower than the earlier unverified reading. Conditions differ in more than one way (Server Mode confirmed on, ADR-005 trim applied, GPU/display state at time of reading unknown for the old number), so this isn't a clean before/after for any single change — but it's a strong signal the combination of changes so far (power plan + startup/services trim) is doing real work, not just theoretical. If isolating individual contributions matters later, re-test one variable at a time.

## Software state (as of 2026-08-04)

- **WSL2 + Ubuntu**: installed via `wsl --install` (elevated). Reboot required before it's usable; Ubuntu first-launch still needs interactive username/password setup.
- **Docker**: not installed yet (`docker --version` → command not found). No Docker Desktop process running. Pending WSL2 reboot.
- **HWiNFO64**: installed under `C:\Program Files\HWiNFO64` (from a prior troubleshooting session) — usable for power/sensor measurement, but no CSV log was ever successfully captured, so no historical readings exist.

## `powercfg /energy` baseline (2026-08-04, 60s trace, `docs/energy-report-2026-08-04.html`)

Note: this tool reports *efficiency problems*, not actual watts — still need a smart plug or HWiNFO power-sensor reading for real before/after numbers.

**Errors found (4):**
1. Sleep timeout disabled while plugged in — expected/intentional, this box needs to stay up as a server. Not something to "fix."
2. Three USB composite devices not entering Selective Suspend, blocking deeper CPU idle states:
   - `PCI\VEN_1022&DEV_43D5` (AMD USB controller) — 2 devices
   - `PCI\VEN_1022&DEV_145F` (AMD USB controller) — 1 device

**Other findings worth acting on:**
- Average CPU utilization during the trace: **1.86%** — the box is genuinely idle at rest, not silently busy.
- 802.11 radio power policy: **Maximum Performance** (not power-saving) — worth switching if Wi-Fi is actually in use (desktop may be wired).
- Video quality policy: **optimize for quality**, not power savings — low impact for a headless server, but free to flip.
- Only 2 CPU idle (C-)states available; P-state floor is 45% of nominal 3.4GHz (~1.5GHz minimum via P-states) — a hardware/firmware ceiling, not something software can tune around.
- Active plan at scan time: **OEM Balanced** (`{381b4222-f694-41f0-9685-ff5bb260df2e}`).
