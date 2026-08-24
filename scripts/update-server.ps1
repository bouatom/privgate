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
# Integrity (all checked BEFORE the running console is stopped):
#   -Sha256 <hex>      expected SHA-256 of -Installer (a directory payload
#                      cannot be pinned by one hash; ship a sha256sums.txt
#                      inside it instead)
#   sha256sums.txt     if this file sits next to -Installer (or inside a
#                      -Payload dir), every listed file is verified
#                      automatically; any mismatch aborts with nothing changed
#
# This script ships inside every console payload (C:\Program Files\PrivGate),
# so it can also update an installed console from a later download.
[CmdletBinding(DefaultParameterSetName = 'ByInstaller')]
param(
  [Parameter(Mandatory, ParameterSetName = 'ByPayload')] [string]$Payload,
  [Parameter(Mandatory, ParameterSetName = 'ByInstaller')] [string]$Installer,
  [string]$DataDir = (Join-Path $env:ProgramData 'PrivGate'),
  [string]$HealthUrl = '',
  [string]$Sha256 = '',
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
$expectedSha256 = ''
if ($Sha256) {
  $expectedSha256 = $Sha256.Trim().ToLowerInvariant()
  if ($expectedSha256 -notmatch '^[0-9a-f]{64}$') {
    Fail '-Sha256 must be a 64-character hex SHA-256 digest'
  }
}

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

# Keep the two newest PrivGate.backup-* directories (the fresh one included);
# everything older is removed after the update has proven healthy. The backup
# created by this run is never deleted, even when -SkipBackup shifted slots.
function Prune-OldBackups {
  $leaf = Split-Path $installDir -Leaf
  $parent = Split-Path $installDir -Parent
  # Stamps sort lexicographically, so Name order == age order.
  $backups = @(Get-ChildItem -LiteralPath $parent -Directory -Filter "$leaf.backup-*" -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending)
  if ($backups.Count -le 2) { return }
  Step 'Pruning old install backups (keeping the newest 2)'
  $slots = 2
  foreach ($dir in $backups) {
    if ($dir.FullName -eq $backupDir) { continue }  # never delete the fresh one
    if ($slots -gt 0) { $slots--; continue }
    Remove-Item -LiteralPath $dir.FullName -Recurse -Force
  }
}

# --- payload integrity (D1): all checks run BEFORE stop/swap; fail closed ---

function Get-Sha256([string]$Path) {
  (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-SumsEntry([string]$SumsPath, [string]$TargetFile) {
  $base = Split-Path $TargetFile -Leaf
  $expected = $null
  foreach ($line in Get-Content -LiteralPath $SumsPath) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) { continue }
    $parts = $line.Trim() -split '\s+', 2
    if ($parts.Count -lt 2) { Fail "malformed line in ${SumsPath}: $line" }
    $name = $parts[1].TrimStart('*').Trim()
    if ($name -eq $base) { $expected = $parts[0].Trim().ToLowerInvariant(); break }
  }
  if (-not $expected) { Fail "$SumsPath has no entry for '$base'" }
  $actual = Get-Sha256 $TargetFile
  if ($actual -ne $expected) {
    Fail "checksum mismatch for '$base': $SumsPath says $expected, file hashes $actual"
  }
}

function Assert-PayloadSums([string]$PayloadDir) {
  $sums = Join-Path $PayloadDir 'sha256sums.txt'
  if (-not (Test-Path $sums)) { return }
  Step 'Verifying sha256sums.txt inside the payload'
  $checked = 0
  foreach ($line in Get-Content -LiteralPath $sums) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) { continue }
    $parts = $line.Trim() -split '\s+', 2
    if ($parts.Count -lt 2) { Fail "malformed line in ${sums}: $line" }
    $rel = $parts[1].TrimStart('*').Trim()
    if ($rel -eq 'sha256sums.txt') { continue }
    $target = Join-Path $PayloadDir $rel
    if (-not (Test-Path $target)) { Fail "sha256sums.txt lists a missing file: $rel" }
    $actual = Get-Sha256 $target
    if ($actual -ne $parts[0].Trim().ToLowerInvariant()) {
      Fail "checksum mismatch for '${rel}': expected $($parts[0]), got $actual"
    }
    $checked++
  }
  if ($checked -eq 0) { Fail "$sums contains no usable entries" }
}

function Assert-ArtifactIntegrity {
  if ($expectedSha256) {
    Step "Verifying checksum of $(Split-Path $Installer -Leaf) against -Sha256"
    $actual = Get-Sha256 $Installer
    if ($actual -ne $expectedSha256) {
      Fail "checksum mismatch for '$Installer': expected $expectedSha256, got $actual"
    }
  }
  $sibling = Join-Path (Split-Path $Installer -Parent) 'sha256sums.txt'
  if (Test-Path $sibling) {
    Step "Verifying $(Split-Path $Installer -Leaf) against $sibling"
    Assert-SumsEntry $sibling $Installer
  }
}

if ($expectedSha256 -and $PSCmdlet.ParameterSetName -eq 'ByPayload') {
  Fail '-Sha256 cannot pin a directory payload; put a sha256sums.txt inside the payload instead'
}

switch ($PSCmdlet.ParameterSetName) {
  'ByPayload' {
    if (-not (Test-Path (Join-Path $Payload 'host.cjs'))) { Fail "--payload is not a console payload: $Payload" }

    Step 'Verifying new payload with artifact-check.cjs'
    & $nodeExe (Join-Path $installDir 'artifact-check.cjs') $Payload
    if ($LASTEXITCODE -ne 0) { Fail 'new payload failed verification; nothing was changed' }
    Assert-PayloadSums $Payload

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
    Assert-ArtifactIntegrity

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
Prune-OldBackups

Step 'Update complete.'
Write-Host @"
Rollback (only if needed):
  Rename-Item '$installDir' '$installDir.bad'
  Rename-Item '$backupDir' '$installDir'
  & '$installDir\service-ctl.cmd' start
Data ($DataDir) was never touched by this update.
"@
