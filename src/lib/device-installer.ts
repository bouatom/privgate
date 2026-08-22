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
    if (name === "bin" || name === "obj" || name.startsWith(".")) continue;
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

Copy-Item (Join-Path $Root "appsettings.json") (Join-Path $InstallDir "appsettings.json") -Force

function Publish-Agent {
  param([string]$Project, [string]$Out)
  & dotnet publish $Project -c Release -o $Out
  if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed for $Project" }
}

$prebuiltAgent = Join-Path $Root "PrivGate.Agent.exe"
$prebuiltHelper = Join-Path $Root "PrivGate.Helper.exe"
if (Test-Path $prebuiltAgent) {
  Copy-Item $prebuiltAgent (Join-Path $InstallDir "PrivGate.Agent.exe") -Force
  if (Test-Path $prebuiltHelper) {
    Copy-Item $prebuiltHelper (Join-Path $InstallDir "PrivGate.Helper.exe") -Force
  }
} elseif (Get-Command dotnet -ErrorAction SilentlyContinue) {
  $agentProj = Join-Path $Root "agent\\PrivGate.Agent.csproj"
  $helperProj = Join-Path $Root "agent\\helper\\PrivGate.Helper.csproj"
  if (-not (Test-Path $agentProj)) { throw "Agent source is missing and no PrivGate.Agent.exe was in the zip." }
  Publish-Agent $agentProj $InstallDir
  if (Test-Path $helperProj) { Publish-Agent $helperProj $InstallDir }
  Copy-Item (Join-Path $Root "appsettings.json") (Join-Path $InstallDir "appsettings.json") -Force
} else {
  throw "Install the .NET 8 SDK, or use a package that already contains PrivGate.Agent.exe."
}

$bin = Join-Path $InstallDir "PrivGate.Agent.exe"
if (-not (Test-Path $bin)) { throw "PrivGate.Agent.exe was not produced." }

$svc = Get-Service -Name "PrivGateBroker" -ErrorAction SilentlyContinue
if ($svc) {
  Stop-Service PrivGateBroker -Force -ErrorAction SilentlyContinue
  sc.exe delete PrivGateBroker | Out-Null
  Start-Sleep -Seconds 1
}

sc.exe create PrivGateBroker binPath= "\`"$bin\`"" start= auto DisplayName= "PrivGate Elevation Broker" | Out-Null
sc.exe description PrivGateBroker "PrivGate SYSTEM elevation broker. Does not disable UAC or store admin passwords." | Out-Null
Start-Service PrivGateBroker

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

On the Windows 11 PC (elevated PowerShell):

  1. Unzip this folder.
  2. Right-click Install-PrivGate.ps1 → Run with PowerShell
     or: powershell -ExecutionPolicy Bypass -File .\\Install-PrivGate.ps1

The script installs a SYSTEM service named PrivGateBroker. It does not
disable UAC, store admin passwords, or use runas /savecred.

If the zip has no .exe files, install the .NET 8 SDK first so the script
can publish the included agent source.

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
  for (const file of walkDir(args.agentRoot)) {
    if (file.rel === "appsettings.json") continue;
    entries.push({
      name: `agent/${file.rel}`,
      data: fs.readFileSync(file.abs),
    });
  }
  return entries;
}
