#Requires -Version 5.1
<#
.SYNOPSIS
Run a PowerShell script in the logged-on user's interactive session and stream
its output back to the caller.

.DESCRIPTION
Exists for one reason: `docker build` cannot run over SSH on this box.

Windows OpenSSH with public-key auth produces a *network* logon token. Docker
Desktop's credential helper reaches for DPAPI-protected user credentials, which
a network logon cannot touch, so every pull or build dies before it reads the
Dockerfile:

    error getting credentials - err: exit status 1,
    out: `A specified logon session does not exist. It may already have been terminated.`

This is not a config.json problem and no Docker setting fixes it - removing
credsStore, setting it to "", and pointing DOCKER_CONFIG at a clean config were
all tried and all fail identically. The credential lookup is not what is
configurable; the logon type is.

So: hand the work to a scheduled task registered with `/IT` ("interactive
task"), which runs in the desktop session that IS logged on (auto-login is
enabled on this box, see status.md), poll for its exit code, and relay its
output. Commands that do not touch the registry - `docker ps`, `exec`,
`compose up` without `--build` - work fine over plain SSH and do not need this.

.PARAMETER Script
Absolute path to the .ps1 to run in the interactive session.

.PARAMETER TimeoutSec
Give up waiting after this long. A cold Next.js build here takes minutes.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Script,
    [string]$ScriptArgs = '',
    [int]$TimeoutSec = 1800
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Script)) { throw "Script not found: $Script" }

$TaskName = 'email-outbound-deploy'
$OutFile  = Join-Path $env:TEMP 'eo-deploy.out'
$ErrFile  = Join-Path $env:TEMP 'eo-deploy.err'
$DoneFile = Join-Path $env:TEMP 'eo-deploy.done'
$Wrapper  = Join-Path $env:TEMP 'eo-deploy-wrapper.ps1'

Remove-Item $OutFile, $ErrFile, $DoneFile -Force -ErrorAction SilentlyContinue

# Start-Process rather than `& $Script`, so the target's own `exit 1` is captured
# as a child exit code instead of terminating this wrapper.
$argList = "'-NoProfile','-ExecutionPolicy','Bypass','-File','$Script'"
foreach ($a in ($ScriptArgs -split '\s+' | Where-Object { $_ })) { $argList += ",'$a'" }

@"
`$p = Start-Process powershell ``
    -ArgumentList @($argList) ``
    -RedirectStandardOutput '$OutFile' -RedirectStandardError '$ErrFile' ``
    -PassThru -Wait -NoNewWindow
Set-Content -Path '$DoneFile' -Value `$p.ExitCode -Encoding ascii
"@ | Set-Content -Path $Wrapper -Encoding ascii

# /IT is the whole point: run in the interactive session of the logged-on user.
# /F replaces any task left behind by an interrupted run.
schtasks /Create /TN $TaskName /F /SC ONCE /ST 00:00 /IT /RU $env:USERNAME `
    /TR "powershell -NoProfile -ExecutionPolicy Bypass -File `"$Wrapper`"" | Out-Null
schtasks /Run /TN $TaskName | Out-Null

Write-Host "    running in the interactive session (task: $TaskName)"

$deadline = (Get-Date).AddSeconds($TimeoutSec)
$shown = 0
try {
    while ((Get-Date) -lt $deadline) {
        # Relay output as it appears, so a long build is not a silent wait.
        if (Test-Path $OutFile) {
            $lines = @(Get-Content $OutFile -ErrorAction SilentlyContinue)
            if ($lines.Count -gt $shown) {
                $lines[$shown..($lines.Count - 1)] | ForEach-Object { Write-Host $_ }
                $shown = $lines.Count
            }
        }
        if (Test-Path $DoneFile) { break }
        Start-Sleep -Seconds 2
    }

    if (-not (Test-Path $DoneFile)) { throw "Timed out after ${TimeoutSec}s waiting for the interactive task." }

    if (Test-Path $ErrFile) {
        $err = Get-Content $ErrFile -ErrorAction SilentlyContinue
        if ($err) { $err | ForEach-Object { Write-Host $_ } }
    }

    $code = [int](Get-Content $DoneFile -Raw).Trim()
    exit $code
}
finally {
    schtasks /Delete /TN $TaskName /F 2>$null | Out-Null
}
