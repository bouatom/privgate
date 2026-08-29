#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const AGENT_EXE = "PrivGate.Agent.exe";
// Outbound firewall helper shipped inside the MSI (canonical content lives in
// firewall-agent.cmd next to this script; src/lib/client-msi.ts embeds the
// same bytes for the live-built flavor so both behave identically).
const FIREWALL_CMD_NAME = "firewall-agent.cmd";
// Stray-terminator helper shipped inside the MSI (canonical content lives in
// stop-stray.cmd next to this script; src/lib/client-msi.ts embeds the same
// bytes via stopStrayCmdContent() for the live-built flavor so both behave
// identically). It force-kills the tray/broker images that ServiceControl
// cannot reach, letting the MajorUpgrade swap the exes in place.
const STOP_CMD_NAME = "stop-stray.cmd";
const API_BASE_SLOT = "http://privgate-api-base.invalid/".padEnd(256, "A");
const TOKEN_SLOT = "privgate-enrollment-token.".padEnd(128, "T");

const dist = process.argv[2];
const out = process.argv[3];
const versionRaw = process.argv[4] || process.env.PRIVGATE_VERSION || "0.2.1";
if (!dist || !out) {
  console.error("usage: build-client-msi.cjs <agent-dist> <out.msi> [version]");
  process.exit(1);
}

function productVersion(raw) {
  const cleaned = String(raw).replace(/^v/i, "").split(/[-+]/)[0];
  const parts = cleaned.split(".").map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  return `${parts[0] || 0}.${parts[1] || 0}.${parts[2] || 0}`;
}

function xmlEscape(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function payloadNames(dir) {
  return fs.readdirSync(dir).filter((name) => {
    if (name.startsWith(".")) return false;
    if (!/^[A-Za-z0-9._-]+$/.test(name)) return false;
    if (/\.(msi|wxs|pdb|xml|nupkg)$/i.test(name)) return false;
    return fs.statSync(path.join(dir, name)).isFile();
  });
}

if (!fs.existsSync(path.join(dist, AGENT_EXE))) {
  console.error(`missing ${AGENT_EXE} in ${dist}`);
  process.exit(1);
}

const names = payloadNames(dist);
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "privgate-client-msi-"));
try {
  for (const name of names) {
    fs.copyFileSync(path.join(dist, name), path.join(stage, name));
  }
  fs.writeFileSync(
    path.join(stage, "appsettings.json"),
    `${JSON.stringify(
      {
        ApiBase: "",
        DeviceId: "",
        DeviceSecret: "",
        TicketSigningKey: "",
        StateDirectory: "",
        EnrollmentToken: "",
      },
      null,
      2,
    )}\n`,
  );
  // cmd.exe misparses goto labels with LF-only endings, so ship CRLF (same
  // reason build.sh runs copy_crlf over its .cmd files).
  fs.writeFileSync(
    path.join(stage, FIREWALL_CMD_NAME),
    fs.readFileSync(path.join(__dirname, FIREWALL_CMD_NAME), "utf8").replace(/\r?\n/g, "\r\n"),
  );
  // Stray-terminator run by StopPrivGateStray on upgrade (see stop-stray.cmd).
  // cmd.exe misparses goto labels with LF-only endings, so ship CRLF too.
  fs.writeFileSync(
    path.join(stage, STOP_CMD_NAME),
    fs.readFileSync(path.join(__dirname, STOP_CMD_NAME), "utf8").replace(/\r?\n/g, "\r\n"),
  );
  const staged = fs.readdirSync(stage);
  const compId = (name, i) => {
    if (name === FIREWALL_CMD_NAME) return "cmpFirewallAgent";
    if (name === STOP_CMD_NAME) return "cmpStopStray";
    if (name === "appsettings.json") return "cmpAppSettings";
    return `cmp${i + 1}`;
  };
  const fileId = (name, i) => {
    if (name === FIREWALL_CMD_NAME) return "filFirewallAgent";
    if (name === STOP_CMD_NAME) return "filStopStray";
    if (name === "appsettings.json") return "filAppSettings";
    return `fil${i + 1}`;
  };
  const components = staged.map((name, i) => {
    const source = xmlEscape(path.join(stage, name));
    if (name === AGENT_EXE) {
      return `          <Component Id="cmp${i + 1}" Guid="*">
            <File Id="fil${i + 1}" Source="${source}" KeyPath="yes" />
            <ServiceInstall Id="BrokerSvc" Name="PrivGateBroker" DisplayName="PrivGate Elevation Broker" Type="ownProcess" Start="auto" Account="LocalSystem" ErrorControl="normal" Description="PrivGate SYSTEM elevation broker. Does not disable UAC or store admin passwords." />
            <ServiceControl Id="BrokerSvcCtl" Name="PrivGateBroker" Start="install" Stop="both" Remove="uninstall" Wait="yes" />
          </Component>`;
    }
    if (name === FIREWALL_CMD_NAME) {
      // Stable ids referenced by the AddAgentFirewall/RemoveAgentFirewall
      // custom actions below (wixl supports only FileKey-based custom
      // actions; the WiX fire: extension is not available in wixl).
      return `          <Component Id="${compId(name, i)}" Guid="9d2c5b7e-6a4f-4e3b-8c1d-2f0a5b6c7d8e">
            <File Id="${fileId(name, i)}" Source="${source}" KeyPath="yes" />
          </Component>`;
    }
    if (name === STOP_CMD_NAME) {
      // Stable id referenced by the StopPrivGateStray custom action below.
      return `          <Component Id="${compId(name, i)}" Guid="3b7e2f4a-9c8d-4e1b-9a3f-1d5c6b7e8f90">
            <File Id="${fileId(name, i)}" Source="${source}" KeyPath="yes" />
          </Component>`;
    }
    if (name === "appsettings.json") {
      // Enrolled DeviceId/secret must survive MajorUpgrade. The MSI still
      // ships a first-run template; NeverOverwrite leaves an existing file.
      return `          <Component Id="cmpAppSettings" Guid="6f2a9c1e-4b8d-4e07-a3c5-8d1e7f0b2a94" NeverOverwrite="yes">
            <File Id="filAppSettings" Source="${source}" KeyPath="yes" />
          </Component>`;
    }
    return `          <Component Id="${compId(name, i)}" Guid="*">
            <File Id="${fileId(name, i)}" Source="${source}" KeyPath="yes" />
          </Component>`;
  });
  const refs = staged.map((name, i) => `        <ComponentRef Id="${compId(name, i)}" />`).join("\n");
  const wxs = `<?xml version="1.0" encoding="utf-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product Id="*" Name="PrivGate Client" Language="1033" Version="${xmlEscape(productVersion(versionRaw))}" Manufacturer="PrivGate" UpgradeCode="b4d9f2c1-8e3a-4d02-af5b-2c3d4e5f6071">
    <Package InstallerVersion="200" Compressed="yes" InstallScope="perMachine" />
    <MediaTemplate EmbedCab="yes" />
    <MajorUpgrade DowngradeErrorMessage="A newer version of PrivGate Client is already installed." />
    <Property Id="APABASE" Value="${xmlEscape(API_BASE_SLOT)}" />
    <Property Id="ENROLLMENTTOKEN" Value="${xmlEscape(TOKEN_SLOT)}" />
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
  const wxsPath = path.join(stage, "client.wxs");
  fs.writeFileSync(wxsPath, wxs);
  const result = spawnSync("wixl", ["--arch", "x64", "-o", out, wxsPath], { encoding: "utf8" });
  if (result.status !== 0 || !fs.existsSync(out)) {
    console.error((result.stderr || result.stdout || "wixl failed").trim());
    process.exit(1);
  }
  console.log(`wrote ${out}`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
