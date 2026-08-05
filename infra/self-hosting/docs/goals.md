# Goals

## 1. Self-host Steel API

Run [steel-browser](https://github.com/steel-dev/steel-browser) (open-source browser API/sandbox for AI agents) on this machine, reachable reliably, via Docker.

- Upstream images: `ghcr.io/steel-dev/steel-browser-api` (port 3000 HTTP, 9223 CDP) and `ghcr.io/steel-dev/steel-browser-ui` (port 5173→80)
- Upstream `docker-compose.yml` sets no CPU/memory limits by default — we should set our own once we know what "normal" usage looks like, so a runaway browser session can't eat the whole box.

## 2. Lowest possible electricity expenditure (primary constraint)

This runs 24/7, so idle/average draw matters far more than peak performance. Candidate levers, roughly in order of expected impact — none of these are done yet, see `status.md`:

- **Power plan tuning**: switch from Balanced to a custom plan with a lower max processor state when idle; disable sleep (server needs to stay reachable) but allow display sleep/off.
- **Trim startup/background load**: prior audit of `HKCU\...\Run` and Win32_StartupCommand / running services turned up candidates — revisit and disable anything not needed for the server role (see decisions log once acted on).
- **GPU**: the GTX 1650 draws idle power just for display output; Steel/Chrome in headless server use doesn't need it. Worth checking whether it can be left unused (no monitor attached) vs. physically removing it — the Ryzen 5 2600 has no integrated graphics, so a GPU can't be removed entirely while a display is needed for local access.
- **Measure, don't assume**: use HWiNFO (already installed, see prior session) and `powercfg /energy` to get before/after wattage numbers for any change claimed to save power. A change without a measurement isn't confirmed.
- **Longer-term/open question**: whether keeping this specific desktop (Ryzen 5 2600 + GTX 1650, ~65W+75W TDP components) is more expensive over time than dedicated low-power hardware (mini PC, N100 box, Raspberry Pi). Not decided — see `decisions.md`.

## 3. Other things that help (open / TBD)

User flagged "maybe other things that help" without specifics yet. Revisit and fill in as they come up — don't invent scope here.
