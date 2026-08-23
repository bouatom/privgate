import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { ZipEntry } from "./zip";

export function safeApiBase(raw: string | undefined, origin: string): string {
  const fallback = origin.replace(/\/$/, "");
  const candidate = (raw || fallback).trim();
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
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

$svc = Get-Service -Name "PrivGateBroker" -ErrorAction SilentlyContinue
if ($svc) {
  Stop-Service PrivGateBroker -Force -ErrorAction SilentlyContinue
  sc.exe delete PrivGateBroker | Out-Null
  Start-Sleep -Seconds 1
}

New-Service -Name PrivGateBroker -BinaryPathName ('"' + $bin + '"') -DisplayName "PrivGate Elevation Broker" -StartupType Automatic | Out-Null
sc.exe description PrivGateBroker "PrivGate SYSTEM elevation broker. Does not disable UAC or store admin passwords." | Out-Null
try {
  Start-Service PrivGateBroker
} catch {
  $log = Join-Path $env:ProgramData "PrivGate\\broker.log"
  $hint = if (Test-Path $log) { Get-Content $log -Tail 30 | Out-String } else { "No broker.log yet." }
  throw ("PrivGateBroker did not start. " + $_.Exception.Message + [Environment]::NewLine + $hint)
}

$helper = Join-Path $InstallDir "PrivGate.Helper.exe"
Write-Host "PrivGate is installed."
Write-Host "Broker service: PrivGateBroker"
if (Test-Path $helper) {
  Write-Host "Standard user elevate: & '$helper' --elevate <path-to-file>"
}
`;
}

export function uninstallScript(): string {
  return `#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
$svc = Get-Service -Name "PrivGateBroker" -ErrorAction SilentlyContinue
if ($svc) {
  Stop-Service PrivGateBroker -Force -ErrorAction SilentlyContinue
  sc.exe delete PrivGateBroker | Out-Null
}
$InstallDir = Join-Path $env:ProgramFiles "PrivGate"
if (Test-Path $InstallDir) {
  Remove-Item $InstallDir -Recurse -Force
}
Write-Host "PrivGate broker removed."
`;
}

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

Standard users elevate with:

  & "C:\\Program Files\\PrivGate\\PrivGate.Helper.exe" --elevate "C:\\path\\app.exe"

Uninstall: Uninstall-PrivGate.ps1 (elevated).
`;
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
    for (const name of fs.readdirSync(dist)) {
      const abs = path.join(dist, name);
      if (!fs.statSync(abs).isFile()) continue;
      entries.push({ name, data: fs.readFileSync(abs) });
    }
  }
  for (const file of walkDir(args.agentRoot)) {
    if (file.rel === "appsettings.json") continue;
    entries.push({
      name: `agent/${file.rel}`,
      data: fs.readFileSync(file.abs),
    });
  }
  return entries;
}
