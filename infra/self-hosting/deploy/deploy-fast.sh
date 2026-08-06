#!/usr/bin/env bash
#
# Fast deploy: compile here, ship the build output, restart there.
#
# The PC compiles this app in ~81s; this Mac does it in ~31s. The Docker layer
# around the build is only ~10s of a deploy, so the win is moving the compile,
# not removing the container.
#
# Only .next is shipped. node_modules stays in the image because `sharp` has a
# platform-native binary - see Dockerfile.runtime.
#
#   ./deploy-fast.sh          build, ship, restart, verify
#   ./deploy-fast.sh --no-build   ship whatever .next already exists
#
set -euo pipefail

PC_HOST="${EO_PC_HOST:-self-hosting-pc}"
PC_REPO="${EO_PC_REPO:-C:/Users/tokki/OneDrive/Documenten/GitHub/email-outbound}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HEALTH_URL="http://localhost:3417/login"
PUBLIC_URL="https://app.paidinfunnel.com/login"

BUILD=1
[ "${1:-}" = "--no-build" ] && BUILD=0

T0=$(date +%s)
elapsed() { echo $(( $(date +%s) - T0 )); }
step() { printf '\n==> [%3ss] %s\n' "$(elapsed)" "$1"; }
fail() { printf '\nFAILED after %ss: %s\n' "$(elapsed)" "$1" >&2; exit 1; }

GIT_SHA="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"

if [ "$BUILD" -eq 1 ]; then
  step "Building locally (NEXT_PUBLIC_* from the server's env, not this Mac's)"
  ENV_SRC="$REPO_ROOT/.env.production.generated"
  [ -f "$ENV_SRC" ] || fail "$ENV_SRC missing - it is the copy of the PC's .env.production."

  # NEXT_PUBLIC_* are inlined into the bundle at build time. Building here with
  # this machine's .env.local would bake dev values into the production image -
  # the same failure shape that once made every request 500 with only a digest.
  # Read them from the server's own env instead.
  # Extracted by name rather than sourced: an env file is data, not shell, and
  # a single unquoted character in any unrelated value would otherwise break or
  # execute something here.
  env_value() { grep -m1 "^$1=" "$ENV_SRC" | cut -d= -f2- | tr -d '\r'; }
  NEXT_PUBLIC_SUPABASE_URL="$(env_value NEXT_PUBLIC_SUPABASE_URL)"
  NEXT_PUBLIC_SUPABASE_ANON_KEY="$(env_value NEXT_PUBLIC_SUPABASE_ANON_KEY)"
  export NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY
  [ -n "$NEXT_PUBLIC_SUPABASE_URL" ] || fail "NEXT_PUBLIC_SUPABASE_URL not found in $ENV_SRC"
  [ -n "$NEXT_PUBLIC_SUPABASE_ANON_KEY" ] || fail "NEXT_PUBLIC_SUPABASE_ANON_KEY not found in $ENV_SRC"

  ( cd "$REPO_ROOT" && npm run build ) || fail "local build failed"
fi

[ -d "$REPO_ROOT/.next" ] || fail "no .next to ship."

step "Shipping .next to $PC_HOST"
# tar over ssh rather than rsync: Windows has tar.exe (bsdtar) but no rsync.
#
# Two exclusions, both large and both useless here:
#   .next/cache     1.2GB incremental compile cache; the server never compiles.
#   .next/standalone 94MB of the ~100MB payload, and actively harmful - it is
#                   the pruned bundle carrying @img/sharp-darwin-arm64. We run
#                   `next start` against .next/server + .next/static and the
#                   image's own linux node_modules, so excluding it both shrinks
#                   the transfer ~4x and guarantees a macOS binary can never
#                   reach the container.
tar czf - -C "$REPO_ROOT" --exclude='.next/cache' --exclude='.next/standalone' .next \
  | ssh -o BatchMode=yes "$PC_HOST" "tar xzf - -C \"$PC_REPO\"" \
  || fail "transfer failed"
echo "    shipped"

step "Restarting the container"
# A docker BUILD cannot run over SSH here (Docker Desktop's credential helper
# needs an interactive logon token - see run-interactive.ps1), so the runtime
# image is built separately and this path only ever restarts against it.
# Building it on demand keeps that an implementation detail rather than a
# documented prerequisite someone has to remember.
if ! ssh -o BatchMode=yes "$PC_HOST" "docker image inspect email-outbound-runtime:latest" >/dev/null 2>&1; then
  echo "    runtime image missing - building it once (this part is slow)"
  ssh -o BatchMode=yes "$PC_HOST" \
    "powershell -NoProfile -ExecutionPolicy Bypass -File \"$PC_REPO/infra/self-hosting/deploy/run-interactive.ps1\" -Script \"$PC_REPO/infra/self-hosting/deploy/build-runtime.ps1\"" \
    || fail "runtime image build failed"
fi
# Both paths bind 3417, so release it first. Stopped, not removed: `docker start
# email-outbound` is the whole rollback.
ssh -o BatchMode=yes "$PC_HOST" "docker stop email-outbound" >/dev/null 2>&1 || true

ssh -o BatchMode=yes "$PC_HOST" \
  "cd /d $PC_REPO && set GIT_SHA=$GIT_SHA && docker compose --env-file .env.production -f infra/self-hosting/deploy/docker-compose.fast.yml up -d" \
  || fail "compose up failed"

step "Waiting for $HEALTH_URL"
deadline=$(( $(date +%s) + 90 ))
# PowerShell rather than curl.exe: a `-w %{http_code}` format string does not
# survive bash -> ssh -> cmd.exe intact, which made this loop time out against a
# container that was already answering 200.
until ssh -o BatchMode=yes "$PC_HOST" \
  "powershell -NoProfile -Command \"(Invoke-WebRequest -Uri $HEALTH_URL -UseBasicParsing -TimeoutSec 10).StatusCode\"" \
  2>/dev/null | grep -q 200; do
  [ "$(date +%s)" -lt "$deadline" ] || {
    ssh -o BatchMode=yes "$PC_HOST" "docker logs email-outbound-fast --tail 40" 2>&1 | sed 's/^/    /'
    fail "did not become healthy"
  }
  sleep 3
done
echo "    healthy"

step "Verifying publicly"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$PUBLIC_URL" || echo 000)"
[ "$code" = "200" ] || fail "$PUBLIC_URL returned $code. Roll back with: ssh $PC_HOST 'docker stop email-outbound-fast; docker start email-outbound'"
echo "    $PUBLIC_URL -> 200"

step "Done"
# tr -d over the whole whitespace class: the value comes back with a trailing
# space as well as CR, and comparing an untrimmed string failed a deploy that
# had in fact shipped the right commit.
live="$(ssh -o BatchMode=yes "$PC_HOST" "docker exec email-outbound-fast printenv GIT_SHA" 2>/dev/null | tr -d '[:space:]')"
echo "    live on the PC : ${live:-unknown}"
echo "    local HEAD     : $GIT_SHA"
[ "$live" = "$GIT_SHA" ] || fail "container reports a different commit than what was built."
printf '\nFast deploy finished in %ss (port 3418; the live app on 3417 is untouched).\n' "$(elapsed)"
