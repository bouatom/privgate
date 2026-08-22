#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const stage = process.argv[2];
const out = process.argv[3];
if (!stage || !out) {
  console.error("usage: generate-wxs.cjs <stage-dir> <out.wxs>");
  process.exit(1);
}

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
    const id = `fil${++fileId}`;
    const cid = `cmp${fileId}`;
    componentRefs.push(cid);
    xml += `${indent}<Component Id="${cid}" Guid="*">\n`;
    xml += `${indent}  <File Id="${id}" Source="${xmlEscape(f.abs)}" KeyPath="yes" />\n`;
    xml += `${indent}</Component>\n`;
  }
  return xml;
}

const inner = emitDirectory(stage, "            ");
const refs = componentRefs.map((id) => `        <ComponentRef Id="${id}" />`).join("\n");

const wxs = `<?xml version="1.0" encoding="utf-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product Id="*" Name="PrivGate Console" Language="1033" Version="0.1.0" Manufacturer="PrivGate" UpgradeCode="a3c8e1b0-7d2f-4c91-9e4a-1b2c3d4e5f60">
  <Package InstallerVersion="200" Compressed="yes" InstallScope="perMachine" />
    <MediaTemplate EmbedCab="yes" />
    <MajorUpgrade DowngradeErrorMessage="A newer version of PrivGate Console is already installed." />
    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="ProgramFiles64Folder">
        <Directory Id="INSTALLDIR" Name="PrivGate">
${inner}        </Directory>
      </Directory>
    </Directory>
    <Feature Id="Main" Title="PrivGate Console" Level="1">
${refs}
    </Feature>
  </Product>
</Wix>
`;

fs.writeFileSync(out, wxs);
console.log(`wrote ${out} (${fileId} files)`);
