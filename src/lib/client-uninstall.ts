import "server-only";

/** Shared Windows client uninstall + Apps & Features (ARP) registration. */

export const CLIENT_ARP_ID = "PrivGateClient";
export const CLIENT_DISPLAY_NAME = "PrivGate Client";
export const UNINSTALL_PS1 = "Uninstall-PrivGate.ps1";

export function clientDisplayVersion(): string {
  const raw = String(process.env.PRIVGATE_VERSION || "0.2.1").replace(/^v/i, "");
  const core = raw.split(/[-+]/)[0] || "0.2.1";
  return core;
}

/** Canonical elevated uninstall script written to Program Files. */
export function uninstallScript(): string {
  return `#Requires -RunAsAdministrator
param([switch]$Quiet)
$ErrorActionPreference = "Stop"
function Say([string]$Message) { if (-not $Quiet) { Write-Host $Message } }

$svc = Get-Service -Name "PrivGateBroker" -ErrorAction SilentlyContinue
if ($svc) {
  Stop-Service PrivGateBroker -Force -ErrorAction SilentlyContinue
  sc.exe delete PrivGateBroker | Out-Null
  Start-Sleep -Seconds 1
}

Remove-Item "HKLM:\\SOFTWARE\\PrivGate" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${CLIENT_ARP_ID}" -Recurse -Force -ErrorAction SilentlyContinue
Remove-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" -Name "PrivGateTray" -ErrorAction SilentlyContinue
Remove-Item (Join-Path $env:ProgramData "PrivGate") -Recurse -Force -ErrorAction SilentlyContinue

$InstallDir = Join-Path $env:ProgramFiles "PrivGate"
if (Test-Path $InstallDir) {
  try {
    Remove-Item $InstallDir -Recurse -Force
  } catch {
    Say "Could not delete $InstallDir (files may still be in use). Remove it after reboot."
  }
}

Say "PrivGate Client removed. The console device record is unchanged."
`;
}

/**
 * Assumes $InstallDir is set and Uninstall-PrivGate.ps1 is already there.
 * Registers per-machine Apps & Features (script installs only; MSI uses WiX ARP).
 */
export function registerArpSnippet(): string {
  const version = clientDisplayVersion();
  return `
$uninstFile = Join-Path $InstallDir "${UNINSTALL_PS1}"
$exe = Join-Path $InstallDir "PrivGate.Agent.exe"
$arp = "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${CLIENT_ARP_ID}"
New-Item -Path $arp -Force | Out-Null
Set-ItemProperty -Path $arp -Name DisplayName -Value "${CLIENT_DISPLAY_NAME}"
Set-ItemProperty -Path $arp -Name Publisher -Value "PrivGate"
Set-ItemProperty -Path $arp -Name DisplayVersion -Value "${version}"
Set-ItemProperty -Path $arp -Name InstallLocation -Value $InstallDir
Set-ItemProperty -Path $arp -Name NoModify -Value 1 -Type DWord
Set-ItemProperty -Path $arp -Name NoRepair -Value 1 -Type DWord
if (Test-Path $exe) { Set-ItemProperty -Path $arp -Name DisplayIcon -Value $exe }
$ps = Join-Path $env:SystemRoot "System32\\WindowsPowerShell\\v1.0\\powershell.exe"
Set-ItemProperty -Path $arp -Name UninstallString -Value ('"{0}" -NoProfile -ExecutionPolicy Bypass -File "{1}"' -f $ps, $uninstFile)
Set-ItemProperty -Path $arp -Name QuietUninstallString -Value ('"{0}" -NoProfile -ExecutionPolicy Bypass -File "{1}" -Quiet' -f $ps, $uninstFile)
$run = "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run"
if (-not (Test-Path $run)) { New-Item -Path $run -Force | Out-Null }
Set-ItemProperty -Path $run -Name PrivGateTray -Value ('"{0}"' -f $exe)
`;
}

/** Writes Uninstall-PrivGate.ps1 into $InstallDir (single-file deployment script). */
export function embedUninstallFileSnippet(): string {
  if (uninstallScript().includes("'@")) {
    throw new Error("uninstall script cannot contain a here-string terminator");
  }
  return `
$uninstFile = Join-Path $InstallDir "${UNINSTALL_PS1}"
@'
${uninstallScript()}
'@ | Set-Content -Path $uninstFile -Encoding UTF8
`;
}
