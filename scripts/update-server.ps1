# PrivGate management-console updater (Windows). Run elevated.
#
# One command, no manual process juggling:
#   verify the new artifact -> stop the running console -> apply
#   -> start again -> health-check. Keeps a backup of the previous install
#   for rollback; zero downtime is NOT attempted.
#
# Usage:
#   update-server.ps1 -Payload <dir>        # raw payload directory
#   update-server.ps1 -Installer <file>     # PrivGate-Console-*.msi or -win-x64.exe
# Common flags:
#   -DataDir <path>    console.env location (default %ProgramData%\PrivGate)
#   -HealthUrl <url>   override health check target
#   -SkipBackup        do not keep PrivGate.backup-<stamp>
#
# This script ships inside every console payload (C:\Program Files\PrivGate),
# so it can also update an installed console from a later download.
[CmdletBinding(DefaultParameterSetName = 'ByInstaller')]
param(
  [Parameter(Mandatory, ParameterSetName = 'ByPayload')] [string]$Payload,
  [Parameter(Mandatory, ParameterSetName = 'ByInstaller')] [string]$Installer,
  [string]$DataDir = (Join-Path $env:ProgramData 'PrivGate'),
  [string]$HealthUrl = '',
  [switch]$SkipBackup
)

$ErrorActionPreference = 'Stop'

function Fail([string]$Message) { throw "update-server: $Message" }
function Step([string]$Message) { Write-Host "==> $Message" }

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Fail 'run elevated (needs to stop/start the system service)'
}

$installDir = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\PrivGate\Console' -Name InstallDir -ErrorAction SilentlyContinue).InstallDir
if (-not $installDir) { $installDir = Join-Path ${env:ProgramFiles} 'PrivGate' }
if (-not (Test-Path (Join-Path $installDir 'node.exe'))) {
  Fail "no existing console found at $installDir (this script updates, it does not install)"
}

$nodeExe = Join-Path $installDir 'node.exe'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = "$installDir.backup-$stamp"

function Stop-Console {
  Step 'Stopping the running console (service + hand-started node.exe)'
  & (Join-Path $installDir 'service-ctl.cmd') stop-all | Out-Null
  Start-Sleep -Seconds 2
  # service-ctl.cmd stop-all covers this too; belt and braces for locked files.
  $strays = Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $nodeExe }
  if ($strays) { $strays | Stop-Process -Force; Start-Sleep -Seconds 1 }
}

function Backup-Current {
  if ($SkipBackup) { return }
  Step "Backing up current install to $backupDir"
  robocopy $installDir $backupDir /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Fail "robocopy backup failed with exit code $LASTEXITCODE" }
}

function Invoke-HealthCheck {
  Step 'Waiting for the management web port to answer'
  $checkArgs = @((Join-Path $installDir 'health-check.cjs'), '--data-dir', $DataDir)
  if ($HealthUrl) { $checkArgs += @('--url', $HealthUrl) }
  & $nodeExe @checkArgs
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "health check failed. Rollback: rename '$backupDir' over '$installDir', then run service-ctl.cmd start"
    Fail 'console did not become healthy after the update'
  }
}

switch ($PSCmdlet.ParameterSetName) {
  'ByPayload' {
    if (-not (Test-Path (Join-Path $Payload 'host.cjs'))) { Fail "--payload is not a console payload: $Payload" }

    Step 'Verifying new payload with artifact-check.cjs'
    & $nodeExe (Join-Path $installDir 'artifact-check.cjs') $Payload
    if ($LASTEXITCODE -ne 0) { Fail 'new payload failed verification; nothing was changed' }

    Backup-Current
    Stop-Console

    Step "Swapping files in $installDir"
    robocopy $Payload $installDir /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { Fail "robocopy swap failed with exit code $LASTEXITCODE" }
    Step 'Preserving secrets and listen settings (write-env.cjs --preserve)'
    & $nodeExe (Join-Path $installDir 'write-env.cjs') --dir $DataDir --preserve | Out-Null

    Step 'Starting console service'
    & (Join-Path $installDir 'service-ctl.cmd') start | Out-Null
  }
  'ByInstaller' {
    if (-not (Test-Path $Installer)) { Fail "installer not found: $Installer" }

    Backup-Current
    # The MSI schedules stop-all before file costing; the NSIS exe stops the
    # service in its own section. Both restart the service when done.
    if ([IO.Path]::GetExtension($Installer) -eq '.msi') {
      Step "Installing $Installer (msiexec /qn)"
      $proc = Start-Process msiexec.exe -ArgumentList "/i", "`"$Installer`"", '/qn', '/norestart' -Wait -PassThru
      if ($proc.ExitCode -ne 0) { Fail "msiexec exited $($proc.ExitCode)" }
    } else {
      Step "Installing $Installer (silent)"
      $proc = Start-Process $Installer -ArgumentList '/S' -Wait -PassThru
      if ($proc.ExitCode -ne 0) { Fail "installer exited $($proc.ExitCode)" }
    }

    Step 'Ensuring the console service is running'
    & (Join-Path $installDir 'service-ctl.cmd') start | Out-Null
  }
}

Invoke-HealthCheck

Step 'Update complete.'
Write-Host @"
Rollback (only if needed):
  Rename-Item '$installDir' '$installDir.bad'
  Rename-Item '$backupDir' '$installDir'
  & '$installDir\service-ctl.cmd' start
Data ($DataDir) was never touched by this update.
"@
