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
  const cleaned = String(raw || process.env.PRIVGATE_VERSION || "0.1.0")
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
    const isCtl = f.name.toLowerCase() === "service-ctl.cmd";
    const id = isCtl ? "filServiceCtl" : `fil${fileId}`;
    const cid = isCtl ? "cmpServiceCtl" : `cmp${fileId}`;
    if (isCtl) serviceCtlFileId = id;
    componentRefs.push(cid);
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
const refs = componentRefs.map((id) => `        <ComponentRef Id="${id}" />`).join("\n");

const startAction = serviceCtlFileId
  ? `
    <CustomAction Id="StartPrivGate" FileKey="${serviceCtlFileId}" ExeCommand="start" Execute="deferred" Impersonate="no" Return="ignore" />
    <InstallExecuteSequence>
      <Custom Action="StartPrivGate" After="InstallFiles">NOT REMOVE</Custom>
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
      </Directory>
    </Directory>
    <Feature Id="Main" Title="PrivGate Console" Level="1">
${refs}
    </Feature>${startAction}
  </Product>
</Wix>
`;

fs.writeFileSync(out, wxs);
console.log(`wrote ${out} (${fileId} files, version ${version})`);
