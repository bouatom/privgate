import "server-only";
import { readFileSync } from "node:fs";
import {
  AGENT_CONFIG,
  AGENT_EXE,
  HELPER_EXE,
  clientBinariesReady,
  clientBinaryPath,
  listClientBinaries,
} from "./client-binaries";
import { embedUninstallFileSnippet, registerArpSnippet } from "./client-uninstall";
import { agentFirewallAllowSnippet } from "./client-firewall";

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function embeddedFiles(): { name: string; b64: string }[] {
  const out: { name: string; b64: string }[] = [];
  for (const name of listClientBinaries()) {
    if (name.toLowerCase() === "appsettings.json") continue;
    const src = clientBinaryPath(name);
    if (!src) continue;
    const buf = readFileSync(src);
    if (buf.length > 20 * 1024 * 1024) {
      throw new Error(`Client file ${name} is too large to embed in the deployment script`);
    }
    out.push({ name, b64: buf.toString("base64") });
  }
  return out;
}

export function deploymentScript(apiBase: string, token: string): string {
  if (!clientBinariesReady()) {
    throw new Error("Windows client binaries are not on this console.");
  }
  const files = embeddedFiles();
  if (!files.some((f) => f.name === AGENT_EXE) || !files.some((f) => f.name === AGENT_CONFIG)) {
    throw new Error("Windows client binaries are not on this console.");
  }
  const base = psQuote(apiBase.replace(/\/$/, ""));
  const tok = psQuote(token);
  const map = files.map((f) => `  ${psQuote(f.name)} = '${f.b64}'`).join("\n");
  return `#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ApiBase = ${base}
$EnrollmentToken = ${tok}
$InstallDir = Join-Path $env:ProgramFiles "PrivGate"

$ndpKey = "HKLM:\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP\\v4\\Full"
$release = (Get-ItemProperty $ndpKey -Name Release -ErrorAction SilentlyContinue).Release
if (-not $release -or $release -lt 528040) {
  throw "PrivGate requires .NET Framework 4.8 or later. Download: https://go.microsoft.com/fwlink/?LinkId=2085155"
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$Files = @{
${map}
}
foreach ($name in $Files.Keys) {
  [IO.File]::WriteAllBytes((Join-Path $InstallDir $name), [Convert]::FromBase64String($Files[$name]))
}
${embedUninstallFileSnippet()}
${registerArpSnippet()}

$settings = @{
  ApiBase = $ApiBase
  DeviceId = ""
  DeviceSecret = ""
  TicketSigningKey = ""
  StateDirectory = ""
  EnrollmentToken = $EnrollmentToken
} | ConvertTo-Json
Set-Content -Path (Join-Path $InstallDir "appsettings.json") -Value $settings -Encoding UTF8

$reg = "HKLM:\\SOFTWARE\\PrivGate\\Client"
New-Item -Path $reg -Force | Out-Null
Set-ItemProperty -Path $reg -Name ApiBase -Value $ApiBase
Set-ItemProperty -Path $reg -Name EnrollmentToken -Value $EnrollmentToken

$bin = Join-Path $InstallDir ${psQuote(AGENT_EXE)}
if (-not (Test-Path $bin)) { throw "${AGENT_EXE} was not written." }
$cfg = Join-Path $InstallDir ${psQuote(AGENT_CONFIG)}
if (-not (Test-Path $cfg)) { throw "${AGENT_CONFIG} was not written. Binding redirects are required on .NET Framework 4.8." }
${agentFirewallAllowSnippet()}
$svc = Get-Service -Name "PrivGateBroker" -ErrorAction SilentlyContinue
if ($svc) {
  Stop-Service PrivGateBroker -Force -ErrorAction SilentlyContinue
  sc.exe delete PrivGateBroker | Out-Null
  Start-Sleep -Seconds 1
}

New-Service -Name PrivGateBroker -BinaryPathName ('"' + $bin + '"') -DisplayName "PrivGate Elevation Broker" -StartupType Automatic | Out-Null
sc.exe description PrivGateBroker "PrivGate SYSTEM elevation broker. Does not disable UAC or store admin passwords." | Out-Null
# Auto-restart on crash: without recovery the broker service stays stopped
# after a crash (GAP-001). Restart after 10s, again after 30s, then 60s; the
# failure counter resets once the service has run for a day.
sc.exe failure PrivGateBroker reset= 86400 actions= restart/10000/restart/30000/restart/60000 | Out-Null
try {
  Start-Service PrivGateBroker
} catch {
  $log = Join-Path $env:ProgramData "PrivGate\\broker.log"
  $hint = if (Test-Path $log) { Get-Content $log -Tail 30 | Out-String } else { "No broker.log yet." }
  throw ("PrivGateBroker did not start. " + $_.Exception.Message + [Environment]::NewLine + $hint)
}

Write-Host "PrivGate client installed. This PC will appear on the console as $env:COMPUTERNAME."
Write-Host "Uninstall from Apps & Features (PrivGate Client) or C:\\Program Files\\PrivGate\\Uninstall-PrivGate.ps1."
Write-Host "After the next sign-in, a PrivGate shield appears near the clock. Right-click it to elevate a program. JIT and pending approvals show as notifications."
$helper = Join-Path $InstallDir ${psQuote(HELPER_EXE)}
if (Test-Path $helper) {
  Write-Host "Standard user elevate: & '$helper' --elevate <path-to-file>"
}
`;
}
