# self-hosting-server

## What this project is

Turning this Windows 10 PC into a 24/7 self-hosted server for [Steel](https://github.com/steel-dev/steel-browser) — an open-source browser API for AI agents (Puppeteer/CDP-controllable Chrome sandbox), run via Docker.

Primary constraint: **minimize electricity cost of running this 24/7**, since the server always stays on. Everything else is secondary to that unless stated otherwise.

## Docs map

- `docs/goals.md` — what we're optimizing for, in priority order
- `docs/hardware.md` — baseline specs of this machine and what they mean for power draw
- `docs/decisions.md` — ADR-style log of decisions made and why (append-only, don't rewrite history — supersede instead)
- `docs/status.md` — current state and next steps, kept current

## Conventions for working in this repo

- Before starting new work, read `docs/status.md` first — it's the "what's true right now" doc.
- When a non-obvious choice gets made (hardware, software, config tradeoffs — especially anything trading convenience for power draw), log it in `docs/decisions.md` as a new ADR entry. Don't edit past entries; add a new one that supersedes if a decision changes.
- Update `docs/status.md` at the end of any session that changes the state of the box (installs, config changes, measurements taken).
- This machine is a shared personal PC, not disposable infra — installing software, enabling Windows features (WSL, Hyper-V), or changing power/service settings should be confirmed before doing, not assumed.
- Prefer measuring over guessing: when a change is supposed to reduce power draw, note in status.md whether it was actually verified with a reading (HWiNFO / powercfg /energy) or is still unverified.
