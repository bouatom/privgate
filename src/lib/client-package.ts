import "server-only";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { enrollmentToken } from "./enrollment";
import { safeApiBase } from "./device-installer";

export function clientBinaryDir(): string {
  return path.join(process.cwd(), "agent", "dist");
}

export function listClientBinaries(): string[] {
  const dir = clientBinaryDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => {
    if (name.startsWith(".")) return false;
    if (!/^[A-Za-z0-9._-]+$/.test(name)) return false;
    const abs = path.join(dir, name);
    return existsSync(abs) && statSync(abs).isFile();
  });
}

export function clientBinaryPath(name: string): string | null {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return null;
  const dir = path.resolve(clientBinaryDir());
  const abs = path.resolve(dir, name);
  if (abs !== dir && !abs.startsWith(dir + path.sep)) return null;
  if (!existsSync(abs) || !statSync(abs).isFile()) return null;
  return abs;
}

export function clientBinariesReady(): boolean {
  return Boolean(clientBinaryPath("PrivGate.Agent.exe"));
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function deploymentScript(apiBase: string, token: string): string {
  const base = psQuote(apiBase.replace(/\/$/, ""));
  const tok = psQuote(token);
  return `#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ApiBase = ${base}
$EnrollmentToken = ${tok}
$InstallDir = Join-Path $env:ProgramFiles "PrivGate"
$Headers = @{ "X-Enrollment-Token" = $EnrollmentToken }

$ndpKey = "HKLM:\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP\\v4\\Full"
$release = (Get-ItemProperty $ndpKey -Name Release -ErrorAction SilentlyContinue).Release
if (-not $release -or $release -lt 528040) {
  throw "PrivGate requires .NET Framework 4.8 or later. Download: https://go.microsoft.com/fwlink/?LinkId=2085155"
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$manifest = Invoke-RestMethod -Headers $Headers -Uri "$ApiBase/api/agent/bootstrap"
if (-not $manifest.files -or $manifest.files.Count -lt 1) {
  throw "This console has no published Windows client binaries."
}
foreach ($name in $manifest.files) {
  $out = Join-Path $InstallDir $name
  Invoke-WebRequest -Headers $Headers -Uri "$ApiBase/api/agent/bootstrap/$name" -OutFile $out
}

$settings = @{
  ApiBase = $ApiBase
  DeviceId = ""
  DeviceSecret = ""
  TicketSigningKey = ""
  StateDirectory = ""
  EnrollmentToken = $EnrollmentToken
} | ConvertTo-Json
Set-Content -Path (Join-Path $InstallDir "appsettings.json") -Value $settings -Encoding UTF8

$bin = Join-Path $InstallDir "PrivGate.Agent.exe"
if (-not (Test-Path $bin)) { throw "PrivGate.Agent.exe was not downloaded." }

$svc = Get-Service -Name "PrivGateBroker" -ErrorAction SilentlyContinue
if ($svc) {
  Stop-Service PrivGateBroker -Force -ErrorAction SilentlyContinue
  sc.exe delete PrivGateBroker | Out-Null
  Start-Sleep -Seconds 1
}

sc.exe create PrivGateBroker binPath= "\`"$bin\`"" start= auto DisplayName= "PrivGate Elevation Broker" | Out-Null
sc.exe description PrivGateBroker "PrivGate SYSTEM elevation broker. Does not disable UAC or store admin passwords." | Out-Null
Start-Service PrivGateBroker

Write-Host "PrivGate client installed. This PC will appear on the console as $env:COMPUTERNAME."
$helper = Join-Path $InstallDir "PrivGate.Helper.exe"
if (Test-Path $helper) {
  Write-Host "Standard user elevate: & '$helper' --elevate <path-to-file>"
}
`;
}

export function msiTool(): "wixl" | null {
  const probe = spawnSync("wixl", ["--version"], { encoding: "utf8" });
  if (probe.error) return null;
  return "wixl";
}

export function clientMsiAvailable(): boolean {
  return clientBinariesReady() && Boolean(msiTool());
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function clientWxs(stage: string, files: string[]): string {
  const components = files.map((name, i) => {
    const id = `cmp${i + 1}`;
    const fid = `fil${i + 1}`;
    const source = xmlEscape(path.join(stage, name));
    if (name === "PrivGate.Agent.exe") {
      return `          <Component Id="${id}" Guid="*">
            <File Id="${fid}" Source="${source}" KeyPath="yes" />
            <ServiceInstall Id="BrokerSvc" Name="PrivGateBroker" DisplayName="PrivGate Elevation Broker" Type="ownProcess" Start="auto" Account="LocalSystem" ErrorControl="normal" Description="PrivGate SYSTEM elevation broker. Does not disable UAC or store admin passwords." />
            <ServiceControl Id="BrokerSvcCtl" Name="PrivGateBroker" Start="install" Stop="both" Remove="uninstall" Wait="yes" />
          </Component>`;
    }
    return `          <Component Id="${id}" Guid="*">
            <File Id="${fid}" Source="${source}" KeyPath="yes" />
          </Component>`;
  });
  const refs = files.map((_, i) => `        <ComponentRef Id="cmp${i + 1}" />`).join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product Id="*" Name="PrivGate Client" Language="1033" Version="0.2.1" Manufacturer="PrivGate" UpgradeCode="b4d9f2c1-8e3a-4d02-af5b-2c3d4e5f6071">
    <Package InstallerVersion="200" Compressed="yes" InstallScope="perMachine" />
    <MediaTemplate EmbedCab="yes" />
    <MajorUpgrade DowngradeErrorMessage="A newer version of PrivGate Client is already installed." />
    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="ProgramFiles64Folder">
        <Directory Id="INSTALLDIR" Name="PrivGate">
${components.join("\n")}
        </Directory>
      </Directory>
    </Directory>
    <Feature Id="Main" Title="PrivGate Client" Level="1">
${refs}
    </Feature>
  </Product>
</Wix>
`;
}

export function buildClientMsi(apiBase: string): Buffer {
  const tool = msiTool();
  if (!tool) throw new Error("MSI tooling (wixl) is not installed on this console.");
  const names = listClientBinaries();
  if (!names.includes("PrivGate.Agent.exe")) {
    throw new Error("Windows client binaries are not published on this console.");
  }
  const stage = mkdtempSync(path.join(tmpdir(), "privgate-msi-"));
  try {
    for (const name of names) {
      const src = clientBinaryPath(name);
      if (!src) continue;
      writeFileSync(path.join(stage, name), readFileSync(src));
    }
    const settings = {
      ApiBase: apiBase.replace(/\/$/, ""),
      DeviceId: "",
      DeviceSecret: "",
      TicketSigningKey: "",
      StateDirectory: "",
      EnrollmentToken: enrollmentToken(),
    };
    writeFileSync(path.join(stage, "appsettings.json"), `${JSON.stringify(settings, null, 2)}\n`);
    const staged = readdirSync(stage);
    const wxsPath = path.join(stage, "client.wxs");
    const msiPath = path.join(stage, "PrivGate-Client.msi");
    writeFileSync(wxsPath, clientWxs(stage, staged));
    const args = ["--arch", "x64", "-o", msiPath, wxsPath];
    const result = spawnSync(tool, args, { encoding: "utf8" });
    if (result.status !== 0 || !existsSync(msiPath)) {
      throw new Error((result.stderr || result.stdout || "wix failed").trim() || "Could not build the MSI");
    }
    return readFileSync(msiPath);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

export { safeApiBase };
