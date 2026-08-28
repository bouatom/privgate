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
import { agentFirewallCmdContent, stopStrayCmdContent } from "./client-firewall";

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

/** Shipped netsh helper name inside both client MSI flavors (see client-firewall.ts). */
const FIREWALL_CMD_NAME = "firewall-agent.cmd";
/** Shipped helper that force-terminates stray broker/tray images before the file swap. */
const STOP_CMD_NAME = "stop-stray.cmd";

function clientWxs(stage: string, files: string[], apiBase: string, token: string): string {
  const compId = (name: string, i: number): string => {
    if (name === FIREWALL_CMD_NAME) return "cmpFirewallAgent";
    if (name === STOP_CMD_NAME) return "cmpStopStray";
    return `cmp${i + 1}`;
  };
  const fileId = (name: string, i: number): string => {
    if (name === FIREWALL_CMD_NAME) return "filFirewallAgent";
    if (name === STOP_CMD_NAME) return "filStopStray";
    return `fil${i + 1}`;
  };
  const components = files.map((name, i) => {
    const source = xmlEscape(path.join(stage, name));
    if (name === AGENT_EXE) {
      return `          <Component Id="${compId(name, i)}" Guid="*">
            <File Id="${fileId(name, i)}" Source="${source}" KeyPath="yes" />
            <ServiceInstall Id="BrokerSvc" Name="PrivGateBroker" DisplayName="PrivGate Elevation Broker" Type="ownProcess" Start="auto" Account="LocalSystem" ErrorControl="normal" Description="PrivGate SYSTEM elevation broker. Does not disable UAC or store admin passwords." />
            <ServiceControl Id="BrokerSvcCtl" Name="PrivGateBroker" Start="install" Stop="both" Remove="uninstall" Wait="yes" />
          </Component>`;
    }
    if (name === FIREWALL_CMD_NAME) {
      // Stable ids so the custom actions below can reference the helper by
      // FileKey (wixl supports only FileKey-based custom actions).
      return `          <Component Id="${compId(name, i)}" Guid="9d2c5b7e-6a4f-4e3b-8c1d-2f0a5b6c7d8e">
            <File Id="${fileId(name, i)}" Source="${source}" KeyPath="yes" />
          </Component>`;
    }
    if (name === STOP_CMD_NAME) {
      return `          <Component Id="${compId(name, i)}" Guid="3b7e2f4a-9c8d-4e1b-9a3f-1d5c6b7e8f90">
            <File Id="${fileId(name, i)}" Source="${source}" KeyPath="yes" />
          </Component>`;
    }
    return `          <Component Id="${compId(name, i)}" Guid="*">
            <File Id="${fileId(name, i)}" Source="${source}" KeyPath="yes" />
          </Component>`;
  });
  const refs = files.map((name, i) => `        <ComponentRef Id="${compId(name, i)}" />`).join("\n");
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
    <CustomAction Id="AddAgentFirewall" FileKey="filFirewallAgent" ExeCommand="add" Execute="deferred" Impersonate="no" Return="ignore" />
    <CustomAction Id="RemoveAgentFirewall" FileKey="filFirewallAgent" ExeCommand="remove" Execute="deferred" Impersonate="no" Return="ignore" />
    <CustomAction Id="StopPrivGateStray" FileKey="filStopStray" ExeCommand="" Execute="deferred" Impersonate="no" Return="ignore" />
    <InstallExecuteSequence>
      <Custom Action="RemoveAgentFirewall" Before="InstallValidate">REMOVE~="ALL"</Custom>
      <Custom Action="AddAgentFirewall" After="InstallFiles">NOT REMOVE~="ALL"</Custom>
      <Custom Action="StopPrivGateStray" After="InstallValidate">NOT REMOVE~="ALL"</Custom>
    </InstallExecuteSequence>
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
    // Outbound firewall helper (cmd.exe misparses labels with LF endings, so
    // ship CRLF exactly like build.sh does for its .cmd files).
    writeFileSync(
      path.join(stage, FIREWALL_CMD_NAME),
      agentFirewallCmdContent().replace(/\r?\n/g, "\r\n"),
    );
    // Stray-terminator run by StopPrivGateStray on upgrade (see client-firewall.ts).
    writeFileSync(path.join(stage, STOP_CMD_NAME), stopStrayCmdContent().replace(/\r?\n/g, "\r\n"));
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
