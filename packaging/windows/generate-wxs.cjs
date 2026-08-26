#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const stage = process.argv[2];
const out = process.argv[3];
if (!stage || !out) {
  console.error("usage: generate-wxs.cjs <stage-dir> <out.wxs> [version]");
  process.exit(1);
}

function productVersion(raw) {
  const cleaned = String(raw || process.env.PRIVGATE_VERSION || "0.2.1")
    .replace(/^v/i, "")
    .split(/[-+]/)[0];
  const parts = cleaned.split(".").map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  return `${parts[0] || 0}.${parts[1] || 0}.${parts[2] || 0}`;
}

const version = productVersion(process.argv[4]);

function walk(dir) {
  const names = fs.readdirSync(dir);
  const files = [];
  const dirs = [];
  for (const name of names) {
    const abs = path.join(dir, name);
    if (fs.statSync(abs).isDirectory()) dirs.push({ name, abs });
    else files.push({ name, abs });
  }
  return { files, dirs };
}

let fileId = 0;
let dirId = 0;
const componentRefs = [];
let serviceCtlFileId = "";
let firewallConsoleFileId = "";

function xmlEscape(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function emitDirectory(abs, indent) {
  const { files, dirs } = walk(abs);
  let xml = "";
  for (const d of dirs) {
    const id = `dir${++dirId}`;
    xml += `${indent}<Directory Id="${id}" Name="${xmlEscape(d.name)}">\n`;
    xml += emitDirectory(d.abs, indent + "  ");
    xml += `${indent}</Directory>\n`;
  }
  for (const f of files) {
    fileId += 1;
    const lower = f.name.toLowerCase();
    const isCtl = lower === "service-ctl.cmd";
    const isFw = lower === "firewall-console.cmd";
    const id = isCtl ? "filServiceCtl" : isFw ? "filFirewallConsole" : `fil${fileId}`;
    const cid = isCtl ? "cmpServiceCtl" : isFw ? "cmpFirewallConsole" : `cmp${fileId}`;
    if (isCtl) serviceCtlFileId = id;
    if (isFw) firewallConsoleFileId = id;
    componentRefs.push(cid);
    // Stop-only, never Remove: upgrade-in-place must stop -> swap -> start
    // with a stable service id (WinSW id PrivGateConsole). A Remove attr here
    // would DELETE and recreate the service on upgrades.
    const serviceXml = isCtl
      ? `${indent}  <ServiceControl Id="scPrivGate" Name="PrivGateConsole" Stop="both" Wait="yes" />\n`
      : "";
    const guid = isCtl ? ' Guid="e4b1a8c2-3d5f-4e7a-9b0c-1d2e3f4a5b6c"' : ' Guid="*"';
    xml += `${indent}<Component Id="${cid}"${guid}>\n`;
    xml += `${indent}  <File Id="${id}" Source="${xmlEscape(f.abs)}" KeyPath="yes" />\n`;
    xml += serviceXml;
    xml += `${indent}</Component>\n`;
  }
  return xml;
}

const inner = emitDirectory(stage, "            ");

// The service wrapper logs to %PROGRAMDATA%\PrivGate\logs (privgate-console.xml
// logpath). Create it — plus the data dir — with machine-default ACLs during
// InstallFiles, before the deferred start action runs write-env.cjs/start, so
// an upgrade onto a system where those dirs are missing or oddly owned cannot
// turn into service-start or log-write failures.
const dataDirsXml = `
      <Directory Id="CommonAppDataFolder">
        <Directory Id="PrivGateDataDir" Name="PrivGate">
          <Directory Id="PrivGateLogsDir" Name="logs">
            <Component Id="cmpDataDirs" Guid="7d1e9f42-8b3c-4d5a-9e2f-1c0b6a7d8e9f">
              <CreateFolder />
            </Component>
          </Directory>
        </Directory>
      </Directory>`;
componentRefs.push("cmpDataDirs");

const refs = componentRefs.map((id) => `        <ComponentRef Id="${id}" />`).join("\n");

// On a MAJOR upgrade Windows Installer sets REMOVE to the upgraded-from
// product code(s) (only a user-initiated uninstall sets REMOVE="ALL").
// `NOT REMOVE` therefore skipped both actions on every upgrade: strays were
// never killed and the service was left STOPPED after the swap. Run both
// unless this transaction IS an uninstall. wixl supports only FileKey-based
// custom actions (no property/directory/script forms), so stop-all still
// resolves to the installed service-ctl.cmd; the ServiceControl entry above
// natively stops/waits the service itself even when that on-disk script is
// older than stop-all.
const startAction = serviceCtlFileId
  ? `
    <CustomAction Id="StopPrivGateStray" FileKey="${serviceCtlFileId}" ExeCommand="stop-all" Execute="immediate" Impersonate="no" Return="ignore" />
    <CustomAction Id="StartPrivGate" FileKey="${serviceCtlFileId}" ExeCommand="start" Execute="deferred" Impersonate="no" Return="ignore" />
    <InstallExecuteSequence>
      <Custom Action="StopPrivGateStray" Before="InstallValidate">NOT REMOVE~="ALL"</Custom>
      <Custom Action="StartPrivGate" After="InstallFiles">NOT REMOVE~="ALL"</Custom>
    </InstallExecuteSequence>`
  : "";

// Inbound Windows Firewall exceptions for the management ports. wixl has no
// WiX Firewall extension support (fire:FirewallException aborts the compile),
// so the rules come from a shipped helper run through FileKey custom actions -
// the same mechanism service-ctl.cmd uses above. The helper resolves the live
// ports from %ProgramData%\PrivGate\console.env (defaults 3000/3001), making
// rule creation order-independent versus StartPrivGate and correct on hosts
// that changed ports after install. Removal runs while the helper file still
// exists (Before="InstallValidate") and only on a real uninstall: during a
// major upgrade REMOVE holds product codes rather than ALL, so upgrades take
// the idempotent delete-then-add refresh instead.
const firewallAction = firewallConsoleFileId
  ? `
    <CustomAction Id="AddConsoleFirewall" FileKey="${firewallConsoleFileId}" ExeCommand="add" Execute="deferred" Impersonate="no" Return="ignore" />
    <CustomAction Id="RemoveConsoleFirewall" FileKey="${firewallConsoleFileId}" ExeCommand="remove" Execute="deferred" Impersonate="no" Return="ignore" />
    <InstallExecuteSequence>
      <Custom Action="RemoveConsoleFirewall" Before="InstallValidate">REMOVE~="ALL"</Custom>
      <Custom Action="AddConsoleFirewall" After="InstallFiles">NOT REMOVE~="ALL"</Custom>
    </InstallExecuteSequence>`
  : "";

const wxs = `<?xml version="1.0" encoding="utf-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product Id="*" Name="PrivGate Console" Language="1033" Version="${xmlEscape(version)}" Manufacturer="PrivGate" UpgradeCode="a3c8e1b0-7d2f-4c91-9e4a-1b2c3d4e5f60">
  <Package InstallerVersion="200" Compressed="yes" InstallScope="perMachine" />
    <MediaTemplate EmbedCab="yes" />
    <MajorUpgrade AllowSameVersionUpgrades="yes" DowngradeErrorMessage="A newer version of PrivGate Console is already installed." />
    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="ProgramFiles64Folder">
        <Directory Id="INSTALLDIR" Name="PrivGate">
${inner}        </Directory>
      </Directory>${dataDirsXml}
    </Directory>
    <Feature Id="Main" Title="PrivGate Console" Level="1">
${refs}
    </Feature>${startAction}${firewallAction}
  </Product>
</Wix>
`;

fs.writeFileSync(out, wxs);
console.log(`wrote ${out} (${fileId} files, version ${version})`);
