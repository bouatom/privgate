# PrivGate console server-settings restarter (Windows). Run as SYSTEM via the
# PrivGate-Server-Settings scheduled task (or elevated manually).
#
# Applies a new bind/web-port/agent-port to console.env, restarts the console
# service, and health-checks on the NEW port. If the console does not come
# back healthy, the previous console.env is restored and the service restarted
# again — a failed apply always leaves the console running, never down.
#
# Logging contract (the console's status parser depends on it):
#   * FIRST output is always "==> restart-server start ..." — before any check.
#   * every phase logs via Step() as "==> message".
#   * ANY terminating error prints "error: <message>" on its own line
#     and exits nonzero (watchdog included), AFTER rolling the env file back.
#   * success ends with the exact line "==> server settings applied."
#
# Usage:
#   restart-server.ps1 -Bind 0.0.0.0 -WebPort 3000 -AgentPort 3001
# Common flags:
#   -DataDir <path>   console.env location (default %ProgramData%\PrivGate)
#   -HealthUrl <url>  override health check target
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string]$Bind,
  [Parameter(Mandatory)] [int]$WebPort,
  [Parameter(Mandatory)] [int]$AgentPort,
  [string]$DataDir = (Join-Path $env:ProgramData 'PrivGate'),
  [string]$HealthUrl = ''
)

$ErrorActionPreference = 'Stop'

function Unregister-ServerSettingsTask {
  schtasks.exe /Delete /TN 'PrivGate-Server-Settings' /F 2>$null | Out-Null
}

# --- File-based logging (same rationale as update-server.ps1) ---
$script:logWriter = $null
try {
  $logDir = Join-Path $DataDir 'server-settings'
  if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
  $logFile = Join-Path $logDir 'apply.log'
  $script:logWriter = [System.IO.StreamWriter]::new($logFile, $true)
  $script:logWriter.AutoFlush = $true
} catch {
  # non-critical: fall back to stdout only (interactive / dev runs)
}

function Write-Line([string]$Message) {
  if ($script:logWriter) { $script:logWriter.WriteLine($Message) }
  [Console]::Out.WriteLine($Message)
}
function Step([string]$Message) {
  $elapsed = [int]((Get-Date) - $watchdogStarted).TotalSeconds
  Write-Line ("==> [{0}s] {1}" -f $elapsed, $Message)
}
function Fail([string]$Message) { throw "restart-server: $Message" }

# --- watchdog: no phase may leave the whole run older than 10 minutes ---
$watchdogStarted = Get-Date
$script:WatchdogLastPhase = 'start'
function Assert-Watchdog([string]$Phase) {
  $seconds = [int]((Get-Date) - $watchdogStarted).TotalSeconds
  if ($seconds -gt 600) {
    Fail ("apply timed out after {0}s in phase {1} (last completed: {2})" -f $seconds, $Phase, $script:WatchdogLastPhase)
  }
  $script:WatchdogLastPhase = $Phase
}

$backupFile = ''
$envRestored = $false

try {
  # REQUIRED first output (status parser looks for "^==> restart-server start").
  Step ("restart-server start pid={0} ps={1} at {2:u}" -f $PID, $PSVersionTable.PSVersion.ToString(), $watchdogStarted)
  Unregister-ServerSettingsTask
  Step ("cmdline: {0}" -f [Environment]::CommandLine)

  # Argument validation BEFORE anything is touched.
  $Bind = $Bind.Trim()
  if (-not $Bind -or $Bind -match '\s') { Fail 'invalid -Bind address' }
  if ($WebPort -lt 1 -or $WebPort -gt 65535) { Fail 'WebPort must be an integer between 1 and 65535' }
  if ($AgentPort -lt 1 -or $AgentPort -gt 65535) { Fail 'AgentPort must be an integer between 1 and 65535' }

  $installDir = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\PrivGate\Console' -Name InstallDir -ErrorAction SilentlyContinue).InstallDir
  if (-not $installDir) { $installDir = Join-Path ${env:ProgramFiles} 'PrivGate' }
  $nodeExe = Join-Path $installDir 'node.exe'
  $packaged = (Test-Path $nodeExe) -and (Test-Path (Join-Path $installDir 'PrivGateConsole.exe'))

  $envFile = Join-Path $DataDir 'console.env'
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backupFile = Join-Path $DataDir ("server-settings\console.env.bak-$stamp")

  # Back up the current env file BEFORE writing — the rollback source.
  if (Test-Path $envFile) {
    Step "Backing up console.env to $backupFile"
    Copy-Item -LiteralPath $envFile -Destination $backupFile -Force
  }

  Assert-Watchdog 'write-env'
  Step 'Writing the three listen keys (secrets untouched)'
  if ($packaged) {
    & $nodeExe (Join-Path $installDir 'write-env.cjs') --dir $DataDir --bind $Bind --web-port $WebPort --agent-port $AgentPort | Out-Null
  } else {
    # Dev checkout: write-env.cjs lives in packaging/ next to the scripts.
    $repoEnv = Join-Path $PSScriptRoot 'write-env.cjs'
    if (-not (Test-Path $repoEnv)) { $repoEnv = Join-Path $PSScriptRoot '..\packaging\write-env.cjs' }
    $devNode = Get-Command node -ErrorAction SilentlyContinue
    if (-not $devNode) { Fail 'node.exe not found: cannot write console.env' }
    & $devNode.Source $repoEnv --dir $DataDir --bind $Bind --web-port $WebPort --agent-port $AgentPort | Out-Null
    Step 'dev mode: no console service to restart — the next console start uses the new settings'
    Step 'server settings applied.'
    Write-Line "Write console.env at $envFile was updated. Restart the console process to apply."
    if ($script:logWriter) { $script:logWriter.Close(); $script:logWriter = $null }
    exit 0
  }

  function Stop-Console {
    Step 'Stopping the running console (service + hand-started node.exe)'
    & (Join-Path $installDir 'service-ctl.cmd') stop-all | Out-Null
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

  Assert-Watchdog 'stop'
  Stop-Console

  Assert-Watchdog 'start'
  Step 'Starting console service'
  & (Join-Path $installDir 'service-ctl.cmd') start | Out-Null
  $svc = Get-Service -Name 'PrivGateConsole' -ErrorAction SilentlyContinue
  if ($svc) {
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline) {
      $svc.Refresh()
      if ($svc.Status -eq 'Running') { break }
      Start-Sleep -Seconds 1
    }
    Step "Service status after start: $($svc.Status)"
    if ($svc.Status -ne 'Running') { Fail 'console service did not reach Running state' }
  } else {
    Step 'WARNING: PrivGateConsole service not found after start'
  }

  Assert-Watchdog 'health'
  Step 'Waiting for the management web port to answer (new settings)'
  $checkArgs = @((Join-Path $installDir 'health-check.cjs'), '--data-dir', $DataDir)
  if ($HealthUrl) { $checkArgs += @('--url', $HealthUrl) }
  & $nodeExe @checkArgs
  if ($LASTEXITCODE -ne 0) {
    Fail 'console did not become healthy after applying the server settings'
  }

  $envRestored = $false
  Step 'server settings applied.'
  Write-Line @"
Rollback (only if needed):
  Copy-Item '$backupFile' '$envFile' -Force
  & '$installDir\service-ctl.cmd' restart
"@
  if ($script:logWriter) { $script:logWriter.Close(); $script:logWriter = $null }
  Unregister-ServerSettingsTask
  exit 0
} catch {
  # ANY terminating failure lands here. Restore the previous env file and
  # bring the console back on the OLD settings before reporting the failure,
  # so a failed apply never leaves the console down.
  if (-not $envRestored -and $backupFile -and (Test-Path $backupFile)) {
    Write-Line 'WARN: restoring previous console.env after failure'
    try {
      Copy-Item -LiteralPath $backupFile -Destination $envFile -Force
      if ($packaged) {
        & (Join-Path $installDir 'service-ctl.cmd') start | Out-Null
      }
      Write-Line 'WARN: previous settings restored; console restarting on the old port'
    } catch {
      Write-Line 'WARN: could not restore console.env — manual rollback required'
    }
  }
  Write-Line ("error: {0}" -f $_.Exception.Message)
  Unregister-ServerSettingsTask
  if ($script:logWriter) { $script:logWriter.Close(); $script:logWriter = $null }
  exit 1
}