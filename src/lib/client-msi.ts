import "server-only";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { enrollmentToken } from "./enrollment";
import {
  AGENT_EXE,
  clientBinariesReady,
  clientBinaryPath,
  listClientBinaries,
  packagedClientMsiPath,
} from "./client-binaries";
import { patchMsiSlots } from "./client-msi-slots";

export function msiTool(): "wixl" | null {
  const probe = spawnSync("wixl", ["--version"], { encoding: "utf8" });
  if (probe.error) return null;
  return "wixl";
}

export function clientMsiAvailable(): boolean {
  return clientBinariesReady() && Boolean(packagedClientMsiPath());
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function clientWxs(stage: string, files: string[], apiBase: string, token: string): string {
  const components = files.map((name, i) => {
    const id = `cmp${i + 1}`;
    const fid = `fil${i + 1}`;
    const source = xmlEscape(path.join(stage, name));
    if (name === AGENT_EXE) {
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
  const version = String(process.env.PRIVGATE_VERSION || "0.2.1").replace(/^v/i, "").split(/[-+]/)[0] || "0.2.1";
  return `<?xml version="1.0" encoding="utf-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product Id="*" Name="PrivGate Client" Language="1033" Version="${xmlEscape(version)}" Manufacturer="PrivGate" UpgradeCode="b4d9f2c1-8e3a-4d02-af5b-2c3d4e5f6071">
    <Package InstallerVersion="200" Compressed="yes" InstallScope="perMachine" />
    <MediaTemplate EmbedCab="yes" />
    <MajorUpgrade DowngradeErrorMessage="A newer version of PrivGate Client is already installed." />
    <Property Id="APABASE" Value="${xmlEscape(apiBase)}" />
    <Property Id="ENROLLMENTTOKEN" Value="${xmlEscape(token)}" />
    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="ProgramFiles64Folder">
        <Directory Id="INSTALLDIR" Name="PrivGate">
${components.join("\n")}
          <Component Id="cmpReg" Guid="e7c1a9b0-4d2e-4f18-9a6b-0c1d2e3f4a5b">
            <RegistryKey Root="HKLM" Key="SOFTWARE\\PrivGate\\Client" Action="createAndRemoveOnUninstall">
              <RegistryValue Name="ApiBase" Type="string" Value="[APABASE]" KeyPath="yes" />
              <RegistryValue Name="EnrollmentToken" Type="string" Value="[ENROLLMENTTOKEN]" />
            </RegistryKey>
          </Component>
          <Component Id="cmpTray" Guid="c8f3e2a1-9b4d-4e17-8c5a-6d7e8f9a0b1c">
            <RegistryValue Root="HKLM" Key="SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" Name="PrivGateTray" Type="string" Value="&quot;[INSTALLDIR]PrivGate.Agent.exe&quot;" KeyPath="yes" />
          </Component>
        </Directory>
      </Directory>
    </Directory>
    <Feature Id="Main" Title="PrivGate Client" Level="1">
${refs}
        <ComponentRef Id="cmpReg" />
        <ComponentRef Id="cmpTray" />
    </Feature>
  </Product>
</Wix>
`;
}

function buildLiveClientMsi(apiBase: string, token: string): Buffer {
  const tool = msiTool();
  if (!tool) throw new Error("MSI tooling (wixl) is not installed on this console.");
  const names = listClientBinaries();
  if (!names.includes(AGENT_EXE)) {
    throw new Error("Windows client binaries are not on this console.");
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
      EnrollmentToken: token,
    };
    writeFileSync(path.join(stage, "appsettings.json"), `${JSON.stringify(settings, null, 2)}\n`);
    const staged = readdirSync(stage);
    const wxsPath = path.join(stage, "client.wxs");
    const msiPath = path.join(stage, "PrivGate-Client.msi");
    writeFileSync(wxsPath, clientWxs(stage, staged, settings.ApiBase, token));
    const result = spawnSync(tool, ["--arch", "x64", "-o", msiPath, wxsPath], { encoding: "utf8" });
    if (result.status !== 0 || !existsSync(msiPath)) {
      throw new Error((result.stderr || result.stdout || "wix failed").trim() || "Could not build the MSI");
    }
    return readFileSync(msiPath);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

export function buildClientMsi(apiBase: string): Buffer {
  const token = enrollmentToken();
  const base = apiBase.replace(/\/$/, "");
  const packaged = packagedClientMsiPath();
  if (packaged) {
    return patchMsiSlots(readFileSync(packaged), base, token);
  }
  if (msiTool() && clientBinariesReady()) {
    return buildLiveClientMsi(base, token);
  }
  throw new Error(
    "MSI is not available on this console. Reinstall from a GitHub Release that includes PrivGate-Client.msi, or download the deployment script.",
  );
}
