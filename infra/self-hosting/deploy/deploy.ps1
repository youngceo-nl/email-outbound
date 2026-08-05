#Requires -Version 5.1
<#
.SYNOPSIS
Pull, validate, rebuild and health-check email-outbound on the self-hosting PC.

.DESCRIPTION
Replaces the manual "git pull + docker compose up --build + go look at the site"
sequence. Everything it checks is something that has actually gone wrong here at
least once:

  - .env.production missing keys, or still holding a <placeholder> value.
  - The NEXT_PUBLIC_* build args interpolating to empty strings, which bakes a
    blank Supabase URL into the bundle and makes middleware.ts throw on every
    request - a digest-only 500 that says nothing in the browser. Fixed by
    passing --env-file explicitly; see the note on that line.
  - The app coming up but failing to serve, where the useful error is only ever
    in `docker logs`. This dumps them for you instead of asking.

.PARAMETER SkipPull
Rebuild from the working tree as-is, without fetching. For testing an uncommitted
change on the box.

.PARAMETER HealthTimeoutSec
How long to wait for the container to answer before declaring failure and
dumping logs. The first build on a cold cache is slow; this clock starts after
the build, not before it.

.EXAMPLE
.\infra\self-hosting\deploy\deploy.ps1
#>
[CmdletBinding()]
param(
    [switch]$SkipPull,
    [int]$HealthTimeoutSec = 120
)

$ErrorActionPreference = 'Stop'

$RepoRoot    = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$ComposeFile = Join-Path $PSScriptRoot 'docker-compose.app.yml'
$EnvFile     = Join-Path $RepoRoot '.env.production'
$ExampleFile = Join-Path $RepoRoot '.env.production.example'
$Container   = 'email-outbound'

# /leads and everything else sit behind the auth redirect in middleware.ts, so a
# healthy app answers them with a 307 to /login. /login itself is the one page
# that returns a real 200 without a session - and it still runs middleware, so
# it fails loudly if the Supabase env is wrong. That makes it the honest probe.
$HealthUrl = 'http://localhost:3417/login'

function Write-Step { param([string]$Message) Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Message) Write-Host "    $Message" -ForegroundColor Green }
function Write-Warn { param([string]$Message) Write-Host "    $Message" -ForegroundColor Yellow }

# Native commands do not throw on a non-zero exit under $ErrorActionPreference,
# so every git/docker call has to be checked by hand.
function Invoke-Checked {
    param([string]$Exe, [string[]]$Arguments)
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "``$Exe $($Arguments -join ' ')`` failed with exit code $LASTEXITCODE."
    }
}

function Show-ContainerLogs {
    param([int]$Tail = 80)
    Write-Step "Last $Tail lines from '$Container'"
    # The container may never have been created (e.g. the build itself failed),
    # in which case this is expected to say nothing useful - don't mask the real
    # error above it with a second one.
    & docker logs $Container --tail $Tail 2>&1 | ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "No logs available - the container was never created. The failure is in the build output above."
    }
}

# Reads KEY=VALUE into a hashtable. Deliberately dumb: no quote stripping, no
# interpolation, because it only ever asks "is this set to something real".
function Read-EnvFile {
    param([string]$Path)
    $result = @{}
    foreach ($line in (Get-Content -LiteralPath $Path)) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $split = $trimmed.IndexOf('=')
        if ($split -lt 1) { continue }
        $result[$trimmed.Substring(0, $split).Trim()] = $trimmed.Substring($split + 1).Trim()
    }
    return $result
}

try {
    Write-Host "email-outbound deploy" -ForegroundColor White
    Write-Host "repo: $RepoRoot"

    # --- 1. Pull -----------------------------------------------------------
    if ($SkipPull) {
        Write-Step 'Skipping git pull (-SkipPull)'
    } else {
        Write-Step 'Pulling latest'
        Push-Location $RepoRoot
        try { Invoke-Checked git @('pull', '--ff-only') } finally { Pop-Location }
    }

    # --- 2. Validate the env file ------------------------------------------
    Write-Step 'Checking .env.production'

    if (-not (Test-Path -LiteralPath $EnvFile)) {
        throw ".env.production not found at $EnvFile`n" +
              "    It is gitignored, so git pull will never bring it - copy it to the repo root by hand.`n" +
              "    Required keys are listed in .env.production.example."
    }

    $envVars = Read-EnvFile $EnvFile

    # Every uncommented key in the example is required. Keeping the list there
    # rather than in this script means adding a var to the template is enough.
    if (-not (Test-Path -LiteralPath $ExampleFile)) { throw "Missing $ExampleFile - cannot determine which keys are required." }
    $required = (Read-EnvFile $ExampleFile).Keys

    $missing = @($required | Where-Object { -not $envVars.ContainsKey($_) -or -not $envVars[$_] })
    if ($missing.Count -gt 0) {
        throw "These keys are missing or empty in .env.production:`n" +
              (($missing | ForEach-Object { "      - $_" }) -join "`n")
    }

    # A <...> value is never intentional - it is a template line someone did not
    # fill in. Catch it across the whole file, not just the required keys: a
    # placeholder INNGEST_EVENT_KEY is worse than an absent one, because
    # inngest/client.ts reads any non-empty value as "use Inngest Cloud".
    $placeholders = @($envVars.Keys | Where-Object { $envVars[$_] -match '^<.*>$' })
    if ($placeholders.Count -gt 0) {
        throw "These keys still hold a <placeholder> value:`n" +
              (($placeholders | ForEach-Object { "      - $_ = $($envVars[$_])" }) -join "`n") +
              "`n    Fill them in, or comment the line out entirely if the service does not exist yet."
    }

    Write-Ok "$($required.Count) required keys present, no placeholders."

    # --- 3. Build and start -------------------------------------------------
    Write-Step 'Building and starting the container'

    # Docker Desktop stores registry credentials via a Windows credential helper
    # that needs the interactive logon session. Over SSH there isn't one, and the
    # build dies with "error getting credentials - A specified logon session does
    # not exist" before it even reads the Dockerfile.
    #
    # Every image this build pulls is public, so no credentials are needed at
    # all. Point DOCKER_CONFIG at a minimal config with no credsStore rather than
    # editing the user's real ~/.docker/config.json, which would also change how
    # Docker Desktop behaves interactively.
    $sshDockerConfig = Join-Path $env:USERPROFILE '.docker-ssh'
    if (-not (Test-Path $sshDockerConfig)) { New-Item -ItemType Directory -Path $sshDockerConfig | Out-Null }
    $cfg = Join-Path $sshDockerConfig 'config.json'
    if (-not (Test-Path $cfg)) { Set-Content -Path $cfg -Value '{}' -Encoding ascii }
    $env:DOCKER_CONFIG = $sshDockerConfig

    # --env-file is load-bearing, not decoration. Compose interpolates the
    # ${NEXT_PUBLIC_*} build args in docker-compose.app.yml from the shell env or
    # from a .env in the compose file's own directory - it does NOT read the
    # env_file: entry for that. Without this flag both bake in as empty strings,
    # Next inlines the blank URL at build time, and middleware.ts throws on every
    # request: a 500 whose only visible trace in the browser is a digest hash.
    Invoke-Checked docker @(
        'compose',
        '--env-file', $EnvFile,
        '-f', $ComposeFile,
        'up', '-d', '--build'
    )

    # --- 4. Health check ----------------------------------------------------
    Write-Step "Waiting for $HealthUrl (up to ${HealthTimeoutSec}s)"

    $deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
    $healthy = $false
    $lastError = 'no response yet'

    while ((Get-Date) -lt $deadline) {
        # If the container has exited there is nothing left to wait for - the
        # logs already hold the reason, so stop burning the timeout.
        $state = (& docker inspect -f '{{.State.Running}}' $Container 2>$null)
        if ($LASTEXITCODE -eq 0 -and $state -ne 'true') {
            throw "Container '$Container' is not running - it exited during startup."
        }

        try {
            $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 10
            if ($response.StatusCode -eq 200) { $healthy = $true; break }
            $lastError = "HTTP $($response.StatusCode)"
        } catch {
            $lastError = $_.Exception.Message
        }
        Start-Sleep -Seconds 3
    }

    if (-not $healthy) {
        throw "App did not become healthy within ${HealthTimeoutSec}s (last: $lastError)."
    }

    Write-Ok 'App is up.'
    Write-Host "`nDeployed. https://app.paidinfunnel.com/leads" -ForegroundColor Green
    exit 0

} catch {
    Write-Host "`nDEPLOY FAILED" -ForegroundColor Red
    Write-Host "    $($_.Exception.Message)" -ForegroundColor Red
    Show-ContainerLogs
    exit 1
}
