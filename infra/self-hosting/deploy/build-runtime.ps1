#Requires -Version 5.1
<#
.SYNOPSIS
Build the runtime image used by the fast deploy path.

.DESCRIPTION
Separate from deploy-fast.sh because this is the only part that needs a Docker
*build*, and a build cannot run over SSH on this box - Docker Desktop's
credential helper needs an interactive logon token. See run-interactive.ps1.

Run it through that wrapper:

  powershell -File run-interactive.ps1 -Script <repo>\infra\self-hosting\deploy\build-runtime.ps1

Only needed when package-lock.json changes. The image carries node_modules and
nothing that changes per commit, so ordinary deploys just restart a container
against a freshly shipped .next and never come near this.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$RepoRoot    = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$ComposeFile = Join-Path $PSScriptRoot 'docker-compose.fast.yml'
$EnvFile     = Join-Path $RepoRoot '.env.production'

if (-not (Test-Path $EnvFile)) { throw ".env.production not found at $EnvFile" }

Write-Host "`n==> Building email-outbound-runtime" -ForegroundColor Cyan
& docker compose --env-file $EnvFile -f $ComposeFile build
if ($LASTEXITCODE -ne 0) { throw "docker compose build failed with exit code $LASTEXITCODE." }

Write-Host "`nRuntime image built. deploy-fast.sh can now restart against it without a build.`n" -ForegroundColor Green
