#Requires -Version 5.1
<#
.SYNOPSIS
Set one key in .env.production without the value appearing anywhere it lasts.

.DESCRIPTION
The value is typed at a hidden prompt, so it stays out of PowerShell history,
the process list, and any chat log used to relay instructions.

    .\set-env-value.ps1 -Key INNGEST_EVENT_KEY

Always takes a timestamped backup first, and reports only the length of what it
wrote - never the value.

.NOTES
The BSTR is read back with PtrToStringBSTR, NOT PtrToStringAuto. This is not a
style preference. PtrToStringAuto marshals as ANSI here and stops at the first
null byte of the UTF-16 buffer, so it silently returns just the FIRST CHARACTER
of whatever was typed. An earlier version of this script used it and truncated
two live Inngest keys to 1 character each, reporting success while doing it.
The failure is invisible without checking the written length, which is why this
script prints it.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Key,
    [string]$EnvFile = 'C:\Users\tokki\OneDrive\Documenten\GitHub\email-outbound\.env.production',
    # Guard against a paste that silently lost characters. Every credential this
    # is used for is far longer than this.
    [int]$MinLength = 8
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $EnvFile)) { throw "Not found: $EnvFile" }
if ($Key -notmatch '^[A-Z][A-Z0-9_]*$') { throw "Key must be UPPER_SNAKE_CASE: '$Key'" }

$secure = Read-Host -Prompt "Value for $Key" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try   { $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }

if ($value.Length -lt $MinLength) {
    throw "Got only $($value.Length) character(s) - well under the $MinLength minimum. " +
          "Nothing was written. Re-run and paste the full value."
}

Copy-Item $EnvFile "$EnvFile.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"

$out = New-Object System.Collections.Generic.List[string]
$replaced = $false
foreach ($line in [IO.File]::ReadAllLines($EnvFile)) {
    if ($line -match "^$([regex]::Escape($Key))=") {
        $out.Add("$Key=$value"); $replaced = $true
    } else {
        $out.Add($line)
    }
}
if (-not $replaced) { $out.Add("$Key=$value") }

# LF, not CRLF: Docker's env_file parser keeps a trailing \r inside the value.
[IO.File]::WriteAllText($EnvFile, ($out -join "`n") + "`n")

Write-Host "$Key set to $($value.Length) chars. Backup written alongside." -ForegroundColor Green
Write-Host "Recreate the container for it to take effect:" -ForegroundColor Cyan
Write-Host "  docker compose --env-file .env.production -f infra/self-hosting/deploy/docker-compose.app.yml up -d"
