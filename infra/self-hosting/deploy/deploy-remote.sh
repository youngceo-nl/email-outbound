#!/usr/bin/env bash
#
# Deploy email-outbound to the self-hosting PC, from a Mac, in one command.
#
# Pushes .env.production (which is gitignored and so can never arrive via git
# pull) and then runs deploy.ps1 on the box, streaming its output back here.
# Requires the Tailscale + OpenSSH setup in ../docs/remote-access.md.
#
#   ./infra/self-hosting/deploy/deploy-remote.sh
#   ./infra/self-hosting/deploy/deploy-remote.sh --skip-env    # code change only
#
set -euo pipefail

# Tailscale MagicDNS name of the PC, and where the repo lives on it. Override
# either from the environment rather than editing this file.
PC_HOST="${EO_PC_HOST:-self-hosting-pc}"
PC_REPO="${EO_PC_REPO:-C:/Users/tokki/OneDrive/Documenten/GitHub/email-outbound}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

# The local source of truth for the server's env. Kept out of git on both ends;
# this script is the only thing that moves it between them.
LOCAL_ENV="${EO_ENV_FILE:-$REPO_ROOT/.env.production.generated}"

# Pushing the env is OPT-IN, and deliberately so. The PC's .env.production is
# the real source of truth - it was assembled on the box and has held keys this
# Mac's copy never had. Defaulting to push would silently delete them, which
# nearly happened once. Only pass --push-env when the local file is genuinely
# newer, and read what the diff reports before confirming.
PUSH_ENV=0
FORCE=0
CHECK_ONLY=0
SKIP_PULL=""
for arg in "$@"; do
  case "$arg" in
    --push-env)  PUSH_ENV=1 ;;
    --force)     FORCE=1 ;;
    --check)     CHECK_ONLY=1 ;;
    --skip-pull) SKIP_PULL="-SkipPull" ;;
    -h|--help)
      sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      echo "  --check      report what is live vs local HEAD, deploy nothing"
      echo "  --push-env   also replace the PC's .env.production (see below)"
      echo "  --skip-pull  build the PC's working tree as-is"
      exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

# Elapsed time on every phase, so "the deploy is slow" is always answerable with
# a number rather than a guess about which part.
T0=$(date +%s)
elapsed() { echo $(( $(date +%s) - T0 )); }
step() { printf '\n==> [%3ss] %s\n' "$(elapsed)" "$1"; }
fail() { printf '\nFAILED after %ss: %s\n' "$(elapsed)" "$1" >&2; exit 1; }

step "Checking the tunnel to $PC_HOST"
command -v tailscale >/dev/null 2>&1 || fail "tailscale not installed - see infra/self-hosting/docs/remote-access.md"
# BatchMode so a missing key fails immediately instead of hanging on a password
# prompt inside what is meant to be an unattended script.
ssh -o BatchMode=yes -o ConnectTimeout=10 "$PC_HOST" "echo ok" >/dev/null 2>&1 \
  || fail "cannot ssh to $PC_HOST. Check 'tailscale status' on both machines, and that OpenSSH Server is running on the PC."
echo "    reachable"

# What is actually serving right now, versus what you have locally. This is the
# whole point of stamping GIT_SHA into the image: "I committed but the page did
# not change" and "the code does not do what I think" look identical in a
# browser, and only this tells them apart.
report_versions() {
  local live local_head
  live="$(ssh -o BatchMode=yes "$PC_HOST" "docker exec email-outbound printenv GIT_SHA" 2>/dev/null | tr -d '\r' || true)"
  local_head="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
  echo "    live on the PC : ${live:-unknown (image predates version stamping)}"
  echo "    local HEAD     : $local_head"
  if [ -n "$live" ] && [ "$live" = "$local_head" ]; then
    echo "    -> up to date"
    return 0
  fi
  echo "    -> DIFFERENT: the running app is not built from your current HEAD"
  return 1
}

if [ "$CHECK_ONLY" -eq 1 ]; then
  step "Version check"
  report_versions || true
  # Uncommitted work never reaches the PC - it deploys from git, not your disk.
  if ! git -C "$REPO_ROOT" diff --quiet || ! git -C "$REPO_ROOT" diff --cached --quiet; then
    echo "    note: you have uncommitted changes; deploying will NOT include them"
  fi
  if [ -n "$(git -C "$REPO_ROOT" log --oneline origin/main..HEAD 2>/dev/null)" ]; then
    echo "    note: local HEAD is ahead of origin/main - push first, the PC pulls from the remote"
  fi
  exit 0
fi

if [ "$PUSH_ENV" -eq 0 ]; then
  step "Leaving the PC's .env.production alone (pass --push-env to replace it)"
else
  step "Replacing $PC_REPO/.env.production with $(basename "$LOCAL_ENV")"
  [ -f "$LOCAL_ENV" ] || fail "$LOCAL_ENV does not exist."

  # Catch unfilled template values here rather than after a multi-minute build.
  # deploy.ps1 checks this too; this is just the faster feedback loop.
  if grep -qE '^[A-Z_]+=<.*>$' "$LOCAL_ENV"; then
    echo "    placeholder values still in the file:" >&2
    grep -nE '^[A-Z_]+=<.*>$' "$LOCAL_ENV" | sed 's/^/      /' >&2
    fail "fill them in, or comment the lines out if the service does not exist yet."
  fi

  # Compare key NAMES only - never pull the remote file's values down here, and
  # never print either side's. Any key the PC has that the local file lacks is
  # about to be destroyed, so refuse unless that is explicitly what was wanted.
  local_keys="$(grep -oE '^[A-Z_]+=' "$LOCAL_ENV" | tr -d '=' | sort -u)"
  remote_keys="$(ssh -o BatchMode=yes "$PC_HOST" \
    "powershell -NoProfile -Command \"Select-String -Path '$PC_REPO/.env.production' -Pattern '^[A-Z_]+=' | ForEach-Object { (\$_.Line -split '=')[0] }\"" \
    2>/dev/null | tr -d '\r' | sort -u)" || remote_keys=""

  lost="$(comm -13 <(echo "$local_keys") <(echo "$remote_keys"))"
  if [ -n "$lost" ]; then
    echo "    the PC has these keys that $(basename "$LOCAL_ENV") does not:" >&2
    echo "$lost" | sed 's/^/      - /' >&2
    [ "$FORCE" -eq 1 ] || fail "pushing would delete them. Add them locally first, or re-run with --force if that is intended."
    echo "    --force given, overwriting anyway" >&2
  fi

  # Timestamped backup on the box, so a bad push is recoverable without a trip
  # to the PC. Cheap; these files are under 1KB.
  ssh -o BatchMode=yes "$PC_HOST" \
    "powershell -NoProfile -Command \"Copy-Item '$PC_REPO/.env.production' ('$PC_REPO/.env.production.bak-' + (Get-Date -Format yyyyMMdd-HHmmss)) -ErrorAction SilentlyContinue\"" \
    >/dev/null 2>&1

  scp -q "$LOCAL_ENV" "$PC_HOST:$PC_REPO/.env.production" \
    || fail "scp failed. If the PC's OpenSSH DefaultShell was set to PowerShell, set it back to cmd.exe - it breaks scp."
  echo "    pushed (previous file backed up on the PC as .env.production.bak-<timestamp>)"
fi

# Pull from here rather than letting deploy.ps1 do it. PowerShell parses a
# script into memory before running it, so a deploy.ps1 that pulls its own
# update still executes the pre-pull copy - which cost one confusing round of
# "the fix is on the box but is not running". Pulling first means the version
# invoked below is always the version that was just fetched.
if [ -n "$SKIP_PULL" ]; then
  step "Skipping git pull (--skip-pull)"
else
  step "Pulling latest on $PC_HOST"
  ssh -o BatchMode=yes "$PC_HOST" "cd /d $PC_REPO && git pull --ff-only" \
    || fail "git pull failed on the PC - check for local changes there."
fi

step "Running deploy.ps1 on $PC_HOST"
# Forward slashes throughout - PC_REPO already uses them, and mixing separators
# is how the first run of this script failed.
REMOTE_SCRIPT="$PC_REPO/infra/self-hosting/deploy/deploy.ps1"
RUNNER="$PC_REPO/infra/self-hosting/deploy/run-interactive.ps1"

# -ExecutionPolicy Bypass because the script is unsigned; -NoProfile so a stray
# user profile on the box cannot change how it behaves.
#
# `|| true` because powershell.exe does NOT reliably propagate failure: given a
# bad -File path it prints an error and still exits 0, which made the first run
# of this script report a successful deploy of nothing. The remote exit code is
# not trustworthy, so the health check below is what actually decides.
# Via run-interactive.ps1, because `docker build` cannot run from an SSH session
# on this box - see the header of that script. -SkipPull because the pull
# already happened above, over a channel that does not need the interactive
# session.
set +e
ssh -t "$PC_HOST" \
  "powershell -NoProfile -ExecutionPolicy Bypass -File \"$RUNNER\" -Script \"$REMOTE_SCRIPT\" -ScriptArgs \"-SkipPull\""
rc=$?
set -e

# Check this BEFORE the health check. A failed build leaves the previous
# container running and serving happily, so the health check would go green and
# report a successful deploy of code that never shipped - which is exactly what
# this script did on its first real run.
[ "$rc" -eq 0 ] || fail "deploy.ps1 exited $rc - see its output above. The previously running container is untouched."

step "Verifying from this Mac"
# Independent of anything the remote reported. /login is the one route that
# returns a real 200 without a session while still executing middleware.
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 https://app.paidinfunnel.com/login || echo 000)"
[ "$code" = "200" ] || fail "https://app.paidinfunnel.com/login returned $code, expected 200."
echo "    https://app.paidinfunnel.com/login -> 200"

# Confirms the new image is the one serving, not just that something is. A
# successful build whose container failed to swap would still answer 200.
report_versions || fail "deployed, but the running container reports a different commit than local HEAD."
