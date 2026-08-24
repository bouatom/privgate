# PrivGate console backup (Windows): privgate.db + console.env into one zip.
# Both files must travel together — device secrets in the DB are
# envelope-encrypted under keys that live only in console.env.
# See docs/backing-up.md.
#
# Usage (elevated PowerShell):
#   .\backup.ps1 [-DataDir <path>] [-Out <file.zip>]
[CmdletBinding()]
param(
  [string]$DataDir = (Join-Path $env:ProgramData 'PrivGate'),
  [string]$Out = ''
)

$ErrorActionPreference = 'Stop'
function Fail([string]$Message) { throw "backup: $Message" }

$db = Join-Path $DataDir 'privgate.db'
$envFile = Join-Path $DataDir 'console.env'
if (-not (Test-Path $db)) { Fail "no database at $db" }
if (-not (Test-Path $envFile)) { Fail "no console.env at $envFile (back up both files together)" }
if (-not $Out) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $Out = Join-Path $DataDir "privgate-backup-$stamp.zip"
}
if (Test-Path $Out) { Fail "refusing to overwrite $Out" }

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Fail 'run elevated (reads console.env and controls the service)'
}

$installDir = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\PrivGate\Console' -Name InstallDir -ErrorAction SilentlyContinue).InstallDir
if (-not $installDir) { $installDir = Join-Path ${env:ProgramFiles} 'PrivGate' }
$ctl = Join-Path $installDir 'service-ctl.cmd'

$work = Join-Path ([IO.Path]::GetTempPath()) ("privgate-backup-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
  # Stop for a consistent copy, then bring the console back regardless.
  if (Test-Path $ctl) { & $ctl stop-all | Out-Null; Start-Sleep -Seconds 2 }
  try {
    Copy-Item -LiteralPath $db -Destination (Join-Path $work 'privgate.db')
    foreach ($extra in @("$db-wal", "$db-shm")) {
      # Leftovers only after an unclean stop; include them if present.
      if (Test-Path $extra) { Copy-Item -LiteralPath $extra -Destination $work }
    }
  } finally {
    if (Test-Path $ctl) { & $ctl start | Out-Null }
  }
  Copy-Item -LiteralPath $envFile -Destination (Join-Path $work 'console.env')

  Compress-Archive -Path (Join-Path $work '*') -DestinationPath $Out
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Backup written: $Out"
Write-Host 'WARNING: the archive contains console.env (signing + device encryption keys). Store it like a secret.'
