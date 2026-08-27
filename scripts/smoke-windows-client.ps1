#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Smoke-test the PrivGate Windows Elevation Broker on Windows 10+.

.DESCRIPTION
  Run after Install-PrivGate.ps1. This Mac cannot execute named-pipe / job-object
  checks; copy this script to the lab PC (or run it from a repo checkout).

  The broker must NOT disable UAC or store admin passwords.
#>
$ErrorActionPreference = "Stop"
$failed = 0

function Check([string]$Name, [scriptblock]$Body) {
  try {
    & $Body
    Write-Host "PASS  $Name"
  } catch {
    $script:failed++
    Write-Host "FAIL  $Name — $($_.Exception.Message)"
  }
}

$installDir = Join-Path $env:ProgramFiles "PrivGate"
$agent = Join-Path $installDir "PrivGate.Agent.exe"
$helper = Join-Path $installDir "PrivGate.Helper.exe"

Check "Broker binaries exist" {
  if (-not (Test-Path $agent)) { throw "missing $agent" }
  if (-not (Test-Path $helper)) { throw "missing $helper" }
  $agentCfg = Join-Path $installDir "PrivGate.Agent.exe.config"
  if (-not (Test-Path $agentCfg)) { throw "missing $agentCfg — binding redirects will not be applied and PrivGateBroker will fail to start" }
  $cfgContent = Get-Content $agentCfg -Raw
  if ($cfgContent -notmatch "System\.Runtime\.CompilerServices\.Unsafe") {
    throw "$agentCfg is present but lacks the Unsafe binding redirect (CLR will throw TypeInitializationException at startup)"
  }
}

Check ".NET Framework 4.8 present" {
  $release = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full" -Name Release).Release
  if ($release -lt 528040) { throw "Release=$release (need >= 528040)" }
}

Check "PrivGateBroker service is running" {
  $svc = Get-Service PrivGateBroker -ErrorAction Stop
  if ($svc.Status -ne "Running") { throw "status=$($svc.Status)" }
}

Check "UAC is still enabled" {
  $uac = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" -Name EnableLUA).EnableLUA
  if ($uac -ne 1) { throw "EnableLUA=$uac (broker must not disable UAC)" }
}

Check "No stored runas credentials" {
  $cmdkey = cmdkey /list 2>$null | Out-String
  if ($cmdkey -match "PrivGate") { throw "unexpected PrivGate entry in credential manager" }
}

Check "Named pipe PrivGateElevation exists" {
  $pipes = [System.IO.Directory]::GetFiles("\\.\pipe\")
  if (-not ($pipes -match "PrivGateElevation")) { throw "pipe not found" }
}

Check "Hard-banned powershell is denied (or JIT-only)" {
  $out = & $helper --elevate "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" | Out-String
  if ($out -notmatch "deny|hard-banned|jit") {
    throw "unexpected helper output: $out"
  }
}

Check "Unsigned / missing publisher path is not silently allowed" {
  $temp = Join-Path $env:TEMP "privgate-smoke-$(Get-Random).exe"
  Copy-Item "$env:SystemRoot\System32\notepad.exe" $temp -Force
  try {
    $out = & $helper --elevate $temp --json | Out-String
    if ($out -match '"decision"\s*:\s*"allow"' -and $out -notmatch '"jit"\s*:\s*true') {
      throw "copied notepad was allowlisted as a new hash? output=$out"
    }
  } finally {
    Remove-Item $temp -Force -ErrorAction SilentlyContinue
  }
}

if ($failed -gt 0) {
  Write-Host "`n$failed check(s) failed."
  exit 1
}
Write-Host "`nAll smoke checks passed."
exit 0
