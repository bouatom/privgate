# PrivGate management-console updater (Windows). Run elevated.
#
# One command, no manual process juggling:
#   verify the new artifact -> stop the running console -> apply
#   -> start again -> health-check. Keeps a backup of the previous install
#   for rollback; zero downtime is NOT attempted.
#
# Logging contract (the console's status parser depends on it):
#   * FIRST output is always "==> updater start ..." — before any check.
#   * every phase logs via Step() as "==> message".
#   * ANY terminating error prints "error: <message>" on its own line
#     and exits nonzero (watchdog included).
#   * success ends with the exact line "==> Update complete."
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

# [Console]::Out instead of Write-Host: with a detached spawn there is no
# console attached, so host-UI writes are not guaranteed to reach the
# redirected stdout handle. Direct handle writes always land in the log fd.
function Write-Line([string]$Message) { [Console]::Out.WriteLine($Message) }
function Step([string]$Message) {
  $elapsed = [int]((Get-Date) - $watchdogStarted).TotalSeconds
  Write-Line ("==> [{0}s] {1}" -f $elapsed, $Message)
}
function Fail([string]$Message) { throw "update-server: $Message" }

# --- watchdog: no phase may leave the whole run older than 10 minutes ---
$watchdogStarted = Get-Date
$script:WatchdogLastPhase = 'start'
function Assert-Watchdog([string]$Phase) {
  $seconds = [int]((Get-Date) - $watchdogStarted).TotalSeconds
  if ($seconds -gt 600) {
    Fail ("update timed out after {0}s in phase {1} (last completed: {2})" -f $seconds, $Phase, $script:WatchdogLastPhase)
  }
  $script:WatchdogLastPhase = $Phase
}

try {
  # REQUIRED first output (status parser looks for "^==> updater start").
  Step ("updater start pid={0} ps={1} at {2:u}" -f $PID, $PSVersionTable.PSVersion.ToString(), $watchdogStarted)
  Step ("cmdline: {0}" -f [Environment]::CommandLine)

  # Windows Event Log — durable audit trail that survives apply.log rotation.
  $eventSource = 'PrivGate'
  try {
    if (-not [System.Diagnostics.EventLog]::SourceExists($eventSource)) {
      New-EventLog -LogName Application -Source $eventSource -ErrorAction Stop
    }
  } catch { /* non-critical: skip if Event Log is unavailable */ }

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

  # Log the currently-installed version for before/after visibility.
  $currentVersion = 'unknown'
  try {
    $versionFile = Join-Path $installDir 'version.json'
    if (Test-Path $versionFile) {
      $v = Get-Content $versionFile -Raw | ConvertFrom-Json
      $currentVersion = $v.version
    }
  } catch { /* non-critical */ }
  Step "current version: $currentVersion"

  # Write the start event to Windows Event Log (informational).
  try {
    Write-EventLog -LogName Application -Source $eventSource -EventId 1001 `
      -EntryType Information -Message "PrivGate self-update started: $currentVersion → (pending)" -ErrorAction SilentlyContinue
  } catch { /* non-critical */ }

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
    # stop-all on a current script already polls until SERVICE_STOPPED and
    # escalates to taskkill /F. Re-check independently below so an OLD on-disk
    # service-ctl.cmd (pre-stop-all: fire-and-forget stop) still leaves us with
    # a quiesced box - a service stuck STOP_PENDING keeps PrivGateConsole.exe
    # locked and the robocopy swap then fails with delete errors.
    $svc = Get-Service -Name 'PrivGateConsole' -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -ne 'Stopped') {
      $deadline = (Get-Date).AddSeconds(20)
      while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
        $svc.Refresh()
        if ($svc.Status -eq 'Stopped') { break }
      }
      if ($svc.Status -ne 'Stopped') {
        $wrapper = Join-Path $installDir 'PrivGateConsole.exe'
        Get-CimInstance Win32_Process -Filter "Name='PrivGateConsole.exe'" |
          Where-Object { $_.ExecutablePath -eq $wrapper } |
          ForEach-Object { taskkill.exe /F /T /PID $_.ProcessId | Out-Null }
        $deadline = (Get-Date).AddSeconds(10)
        while ((Get-Date) -lt $deadline) {
          Start-Sleep -Milliseconds 500
          $svc.Refresh()
          if ($svc.Status -eq 'Stopped') { break }
        }
      }
    }
    # Hand-started node.exe locks node.exe and the .next payload. Graceful kill
    # first (SIGTERM parity), bounded drain window, then force.
    $strays = Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $nodeExe }
    if ($strays) {
      $strays | ForEach-Object { taskkill.exe /PID $_.Id 2>$null | Out-Null }
      $deadline = (Get-Date).AddSeconds(5)
      while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
        $strays = Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $nodeExe }
        if (-not $strays) { break }
      }
      $strays = Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $nodeExe }
      if ($strays) { $strays | Stop-Process -Force }
    }
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
      Write-Line "WARN: health check failed. Rollback: rename '$backupDir' over '$installDir', then run service-ctl.cmd start"
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

      Assert-Watchdog 'verify-payload'
      Step 'Verifying new payload with artifact-check.cjs'
      & $nodeExe (Join-Path $installDir 'artifact-check.cjs') $Payload
      if ($LASTEXITCODE -ne 0) { Fail 'new payload failed verification; nothing was changed' }
      Assert-PayloadSums $Payload

      Assert-Watchdog 'backup'
      Backup-Current

      Assert-Watchdog 'stop'
      Stop-Console

      Assert-Watchdog 'swap'
      Step "Swapping files in $installDir"
      robocopy $Payload $installDir /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
      if ($LASTEXITCODE -ge 8) { Fail "robocopy swap failed with exit code $LASTEXITCODE" }

      Assert-Watchdog 'write-env'
      Step 'Preserving secrets and listen settings (write-env.cjs --preserve)'
      & $nodeExe (Join-Path $installDir 'write-env.cjs') --dir $DataDir --preserve | Out-Null

      Assert-Watchdog 'start'
      Step 'Starting console service'
      & (Join-Path $installDir 'service-ctl.cmd') start | Out-Null

      # Confirm the service actually reached Running state.
      $svc = Get-Service -Name 'PrivGateConsole' -ErrorAction SilentlyContinue
      if ($svc) {
        $deadline = (Get-Date).AddSeconds(15)
        while ((Get-Date) -lt $deadline) {
          $svc.Refresh()
          if ($svc.Status -eq 'Running') { break }
          Start-Sleep -Seconds 1
        }
        Step "Service status after start: $($svc.Status)"
        if ($svc.Status -ne 'Running') { Fail "console service did not reach Running state" }
      } else {
        Step "WARNING: PrivGateConsole service not found after start"
      }
    }
    'ByInstaller' {
      if (-not (Test-Path $Installer)) { Fail "installer not found: $Installer" }
      Assert-ArtifactIntegrity

      Assert-Watchdog 'backup'
      Backup-Current
      # Both installers are self-sufficient on the stop path: the MSI stops the
      # service natively (ServiceControl) and runs stray-kill before file
      # costing; the NSIS exe extracts its own current service-ctl.cmd (never
      # the older on-disk copy), polls for STOPPED and escalates to taskkill /F.
      # Neither deletes/recreates the service identity. The health check below
      # is what actually proves the swap worked.
      Assert-Watchdog 'install'
      if ([IO.Path]::GetExtension($Installer) -eq '.msi') {
        Step "Installing $Installer (msiexec /qn)"
        $proc = Start-Process msiexec.exe -ArgumentList "/i", "`"$Installer`"", '/qn', '/norestart' -Wait -PassThru
        if ($proc.ExitCode -ne 0) { Fail "msiexec exited $($proc.ExitCode)" }
      } else {
        Step "Installing $Installer (silent)"
        $proc = Start-Process $Installer -ArgumentList '/S' -Wait -PassThru
        if ($proc.ExitCode -ne 0) { Fail "installer exited $($proc.ExitCode)" }
      }

      Assert-Watchdog 'start'
      Step 'Ensuring the console service is running'
      & (Join-Path $installDir 'service-ctl.cmd') start | Out-Null

      # Confirm the service actually reached Running state.
      $svc = Get-Service -Name 'PrivGateConsole' -ErrorAction SilentlyContinue
      if ($svc) {
        $deadline = (Get-Date).AddSeconds(15)
        while ((Get-Date) -lt $deadline) {
          $svc.Refresh()
          if ($svc.Status -eq 'Running') { break }
          Start-Sleep -Seconds 1
        }
        Step "Service status after start: $($svc.Status)"
        if ($svc.Status -ne 'Running') { Fail "console service did not reach Running state" }
      } else {
        Step "WARNING: PrivGateConsole service not found after start"
      }
    }
  }

  Assert-Watchdog 'health'
  Invoke-HealthCheck

  Assert-Watchdog 'prune'
  Prune-OldBackups

  Step 'Update complete.'
  # Log the new version for before/after visibility.
  try {
    $newVersionFile = Join-Path $installDir 'version.json'
    if (Test-Path $newVersionFile) {
      $nv = Get-Content $newVersionFile -Raw | ConvertFrom-Json
      Step "new version: $($nv.version)"
    }
  } catch { /* non-critical */ }
  try {
    Write-EventLog -LogName Application -Source $eventSource -EventId 1002 `
      -EntryType Information -Message "PrivGate self-update succeeded: $currentVersion → (see version.json)" -ErrorAction SilentlyContinue
  } catch { /* non-critical */ }
  Write-Line @"
Rollback (only if needed):
  Rename-Item '$installDir' '$installDir.bad'
  Rename-Item '$backupDir' '$installDir'
  & '$installDir\service-ctl.cmd' start
Data ($DataDir) was never touched by this update.
"@
  exit 0
} catch {
  # ANY terminating failure lands here — including Fail(), cmdlet errors and
  # the watchdog — so the apply log always carries an "error:" line.
  Write-Line ("error: {0}" -f $_.Exception.Message)
  try {
    Write-EventLog -LogName Application -Source $eventSource -EventId 1003 `
      -EntryType Error -Message "PrivGate self-update failed: $($_.Exception.Message)" -ErrorAction SilentlyContinue
  } catch { /* non-critical */ }
  exit 1
}
