import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { ZipEntry } from "./zip";
import { registerArpSnippet, uninstallScript } from "./client-uninstall";
import { agentFirewallAllowSnippet } from "./client-firewall";

// Hosts that an enrolled broker on another machine can never reach. If a
// candidate ApiBase resolves here it is useless to a remote agent (it is either
// the console listening on a wildcard address or a loopback bind), so we must
// not bake it into an installer — doing so is what wedged WS-SOHO-03 into a
// self-reinforcing `0.0.0.0:3001` config loop (see the update-sweep field test).
const NON_ROUTABLE_HOSTS = new Set(["0.0.0.0", "::", "[::]", "127.0.0.1", "::1", "localhost"]);

/**
 * Coerce a candidate ApiBase into a routable http(s) origin.
 *
 * `origin` is the ultimate fallback. `raw` is a caller/request-supplied value
 * (e.g. echoed from the agent's own config) that must never win when it is
 * empty, non-http(s), or points at a wildcard/loopback host — in those cases we
 * drop it and use `origin`.
 */
export function safeApiBase(raw: string | undefined, origin: string): string {
  const fallback = origin.replace(/\/$/, "");
  const candidate = (raw || "").trim() || fallback;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
    if (NON_ROUTABLE_HOSTS.has(url.hostname.toLowerCase())) return fallback;
    return url.origin;
  } catch {
    return fallback;
  }
}

export function installerFileName(hostname: string) {
  const slug = hostname.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "device";
  return `PrivGate-${slug}.zip`;
}

function walkDir(root: string, rel = ""): Array<{ rel: string; abs: string }> {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) return [];
  const out: Array<{ rel: string; abs: string }> = [];
  for (const name of fs.readdirSync(dir)) {
    if (name === "bin" || name === "obj" || name === "dist" || name.startsWith(".")) continue;
    const nextRel = rel ? `${rel}/${name}` : name;
    const abs = path.join(root, nextRel);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) out.push(...walkDir(root, nextRel));
    else out.push({ rel: nextRel, abs });
  }
  return out;
}

export function installScript(): string {
  return `#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallDir = Join-Path $env:ProgramFiles "PrivGate"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# Verify .NET Framework 4.8 is installed.
# Release key 528040 = .NET Framework 4.8 on Windows 10 May 2019 Update and later;
# 528049 = Windows 10 November 2019 / Server 2019+. Both are >= 528040.
$ndpKey = "HKLM:\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP\\v4\\Full"
$release = (Get-ItemProperty $ndpKey -Name Release -ErrorAction SilentlyContinue).Release
if (-not $release -or $release -lt 528040) {
  throw "PrivGate requires .NET Framework 4.8 or later (supported on Windows 7 SP1+ and Windows Server 2008 R2 SP1+). Download from: https://go.microsoft.com/fwlink/?LinkId=2085155"
}

Copy-Item (Join-Path $Root "appsettings.json") (Join-Path $InstallDir "appsettings.json") -Force

function Publish-Agent {
  param([string]$Project, [string]$Out)
  & dotnet publish $Project -c Release -f net48 -o $Out
  if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed for $Project" }
}

$prebuiltAgent = Join-Path $Root "PrivGate.Agent.exe"
$prebuiltHelper = Join-Path $Root "PrivGate.Helper.exe"
if (Test-Path $prebuiltAgent) {
  # Copy the pre-built exe and all sibling DLLs (System.Text.Json etc.) from the zip.
  Get-ChildItem $Root -File | Where-Object { $_.Name -ne "appsettings.json" -and $_.Name -notlike "*.ps1" -and $_.Name -ne "README.txt" } | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $InstallDir $_.Name) -Force
  }
} elseif (Get-Command dotnet -ErrorAction SilentlyContinue) {
  $agentProj = Join-Path $Root "agent\\PrivGate.Agent.csproj"
  $helperProj = Join-Path $Root "agent\\helper\\PrivGate.Helper.csproj"
  if (-not (Test-Path $agentProj)) { throw "Agent source is missing and no PrivGate.Agent.exe was in the zip." }
  Publish-Agent $agentProj $InstallDir
  if (Test-Path $helperProj) { Publish-Agent $helperProj $InstallDir }
  Copy-Item (Join-Path $Root "appsettings.json") (Join-Path $InstallDir "appsettings.json") -Force
} else {
  throw "No PrivGate.Agent.exe found in zip and the .NET SDK is not installed. Use a pre-built zip package."
}

$bin = Join-Path $InstallDir "PrivGate.Agent.exe"
if (-not (Test-Path $bin)) { throw "PrivGate.Agent.exe was not produced." }
$cfg = Join-Path $InstallDir "PrivGate.Agent.exe.config"
if (-not (Test-Path $cfg)) { throw "PrivGate.Agent.exe.config was not installed. Binding redirects are required on .NET Framework 4.8." }
if (-not (Select-String -Path $cfg -Pattern "System.Runtime.CompilerServices.Unsafe" -Quiet)) {
  throw "PrivGate.Agent.exe.config is missing the System.Runtime.CompilerServices.Unsafe binding redirect."
}
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

$helper = Join-Path $InstallDir "PrivGate.Helper.exe"
Copy-Item (Join-Path $Root "Uninstall-PrivGate.ps1") (Join-Path $InstallDir "Uninstall-PrivGate.ps1") -Force
${registerArpSnippet()}
Write-Host "PrivGate is installed."
Write-Host "Broker service: PrivGateBroker"
Write-Host "Uninstall from Apps & Features (PrivGate Client) or Uninstall-PrivGate.ps1."
Write-Host "After the next sign-in, a PrivGate shield appears near the clock. Right-click it to elevate a program."
if (Test-Path $helper) {
  Write-Host "Standard user elevate: & '$helper' --elevate <path-to-file>"
}
`;
}

export { uninstallScript };

export function installerReadme(hostname: string, apiBase: string): string {
  return `PrivGate device installer
=========================

Host: ${hostname}
Control plane: ${apiBase}

Supported OS
------------
Windows 7 SP1 / 8.1 / 10 / 11
Windows Server 2008 R2 SP1 / 2012 / 2012 R2 / 2016 / 2019 / 2022 / 2025

Prerequisite: .NET Framework 4.8
  Pre-installed on Windows 10 (1903+) and Windows Server 2019+.
  For older systems, download from:
  https://go.microsoft.com/fwlink/?LinkId=2085155
  The installer will stop with a clear error if .NET Framework 4.8 is absent.

Windows Server 2008 (non-R2) is NOT supported by this package.
That OS version tops out at .NET Framework 4.6 and would require a
custom build; contact your administrator for details.

Install
-------
  1. Unzip this folder on the target PC.
  2. Open an elevated PowerShell and run:
       powershell -ExecutionPolicy Bypass -File .\\Install-PrivGate.ps1

The script installs a SYSTEM service named PrivGateBroker. It does not
disable UAC, store admin passwords, or use runas /savecred.

If the zip contains no .exe files (source-only package), the .NET SDK
must also be installed so the script can compile and publish the agent.
Pre-built zips (downloaded from Devices → Download installer) include
the compiled binaries and do not require the SDK on the target machine.

After the next sign-in a PrivGate shield appears near the clock. Right-click
it to elevate a program, or:

  & "C:\\Program Files\\PrivGate\\PrivGate.Helper.exe" --elevate "C:\\path\\app.exe"

JIT does not intercept Start-menu tools. Sign out and back in after a JIT
grant, or elevate diskmgmt.msc from the tray.

Uninstall: Apps & Features (PrivGate Client), or Uninstall-PrivGate.ps1 (elevated).
`;
}

function requirePublishedBindingRedirects(entries: ZipEntry[], agentRoot: string) {
  const publishedExe = path.join(agentRoot, "dist", "PrivGate.Agent.exe");
  if (!fs.existsSync(publishedExe)) return;
  const cfg = entries.find((e) => e.name === "PrivGate.Agent.exe.config");
  const text = !cfg ? "" : Buffer.isBuffer(cfg.data) ? cfg.data.toString("utf8") : String(cfg.data);
  if (!text.includes("System.Runtime.CompilerServices.Unsafe")) {
    throw new Error(
      "Published agent is missing binding redirects in PrivGate.Agent.exe.config. Rebuild the Windows client.",
    );
  }
}

export function buildInstallerEntries(args: {
  hostname: string;
  deviceId: string;
  deviceSecret: string;
  apiBase: string;
  ticketSigningKey: string;
  agentRoot: string;
}): ZipEntry[] {
  const appsettings = JSON.stringify(
    {
      ApiBase: args.apiBase,
      DeviceId: args.deviceId,
      DeviceSecret: args.deviceSecret,
      TicketSigningKey: args.ticketSigningKey,
      StateDirectory: "",
    },
    null,
    2,
  );
  const entries: ZipEntry[] = [
    { name: "Install-PrivGate.ps1", data: installScript() },
    { name: "Uninstall-PrivGate.ps1", data: uninstallScript() },
    { name: "appsettings.json", data: appsettings },
    { name: "README.txt", data: installerReadme(args.hostname, args.apiBase) },
  ];
  const dist = path.join(args.agentRoot, "dist");
  if (fs.existsSync(dist)) {
    // Ship only production payload from dist: keep the same excludes as the
    // MSI packager so debug symbols (PDB) and other build/config artifacts
    // never land inside the device installer (GAP-002).
    const skip = /\.(msi|wxs|pdb|xml|nupkg)$/i;
    for (const name of fs.readdirSync(dist)) {
      if (skip.test(name)) continue;
      const abs = path.join(dist, name);
      if (!fs.statSync(abs).isFile()) continue;
      entries.push({ name, data: fs.readFileSync(abs) });
    }
  }
  requirePublishedBindingRedirects(entries, args.agentRoot);
  for (const file of walkDir(args.agentRoot)) {
    if (file.rel === "appsettings.json") continue;
    entries.push({
      name: `agent/${file.rel}`,
      data: fs.readFileSync(file.abs),
    });
  }
  return entries;
}
