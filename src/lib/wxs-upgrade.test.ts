import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const generateWxs = path.resolve(__dirname, "../../packaging/windows/generate-wxs.cjs");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("generate-wxs upgrade metadata", () => {
  it("emits a versioned MajorUpgrade that can replace the same product", () => {
    const root = mkdtempSync(path.join(tmpdir(), "privgate-wxs-"));
    dirs.push(root);
    const stage = path.join(root, "stage");
    mkdirSync(stage);
    writeFileSync(path.join(stage, "service-ctl.cmd"), "@echo off\r\n");
    // Shipped with every payload by build.sh; drives the inbound firewall
    // rules through FileKey custom actions.
    writeFileSync(path.join(stage, "firewall-console.cmd"), "@echo off\r\n");
    writeFileSync(path.join(stage, "readme.txt"), "x\n");
    const out = path.join(root, "privgate.wxs");

    const result = spawnSync(process.execPath, [generateWxs, stage, out, "2.3.4-nightly"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);

    const xml = readFileSync(out, "utf8");
    expect(xml).toContain('Version="2.3.4"');
    expect(xml).toContain('UpgradeCode="a3c8e1b0-7d2f-4c91-9e4a-1b2c3d4e5f60"');
    expect(xml).toContain('AllowSameVersionUpgrades="yes"');
    expect(xml).toContain('Name="PrivGateConsole"');
    expect(xml).toContain('Stop="both"');
    expect(xml).toContain('Id="StartPrivGate"');
    // Stray hand-started consoles must be stopped before MSI costs files, or
    // msiexec raises FilesInUse and silent updates fail. On a major upgrade
    // REMOVE holds the upgraded-from product code(s); only an uninstall sets
    // REMOVE="ALL", so the old `NOT REMOVE` condition skipped stray-kill AND
    // service start on every upgrade.
    expect(xml).toContain('Id="StopPrivGateStray"');
    expect(xml).toMatch(/<Custom Action="StopPrivGateStray" Before="InstallValidate">NOT REMOVE~="ALL"<\/Custom>/);
    expect(xml).toMatch(/<Custom Action="StartPrivGate" After="InstallFiles">NOT REMOVE~="ALL"<\/Custom>/);
    // Upgrade-in-place stops -> swaps -> starts with a stable service id: the
    // ServiceControl entry must never grow a Remove attribute (that deletes
    // and recreates the service on upgrades).
    expect(xml).toMatch(/<ServiceControl Id="scPrivGate" Name="PrivGateConsole" Stop="both" Wait="yes"\s*\/>/);
    expect(xml).not.toContain("Remove=");
    expect(xml).toContain("MajorUpgrade");
  });

  it("opens and removes the inbound firewall ports via shipped helper custom actions", () => {
    const root = mkdtempSync(path.join(tmpdir(), "privgate-wxs-fw-"));
    dirs.push(root);
    const stage = path.join(root, "stage");
    mkdirSync(stage);
    writeFileSync(path.join(stage, "service-ctl.cmd"), "@echo off\r\n");
    writeFileSync(path.join(stage, "firewall-console.cmd"), "@echo off\r\n");
    const out = path.join(root, "privgate.wxs");

    const result = spawnSync(process.execPath, [generateWxs, stage, out, "2.3.4"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);

    const xml = readFileSync(out, "utf8");
    // wixl cannot compile fire:FirewallException, so the helper file gets
    // stable component/file ids that the FileKey custom actions reference.
    expect(xml).toContain('<Component Id="cmpFirewallConsole"');
    expect(xml).toContain('<File Id="filFirewallConsole"');
    expect(xml).toMatch(/<ComponentRef Id="cmpFirewallConsole" \/>/);
    expect(xml).toContain('Id="AddConsoleFirewall" FileKey="filFirewallConsole" ExeCommand="add" Execute="deferred" Impersonate="no" Return="ignore"');
    expect(xml).toContain('Id="RemoveConsoleFirewall" FileKey="filFirewallConsole" ExeCommand="remove" Execute="deferred" Impersonate="no" Return="ignore"');
    // Install: after files exist; skip on uninstall only (upgrades refresh).
    expect(xml).toMatch(/<Custom Action="AddConsoleFirewall" After="InstallFiles">NOT REMOVE~="ALL"<\/Custom>/);
    // Uninstall: while the helper file is still on disk (before costing) and
    // only for a real uninstall, never for a major upgrade.
    expect(xml).toMatch(/<Custom Action="RemoveConsoleFirewall" Before="InstallValidate">REMOVE~="ALL"<\/Custom>/);
  });

  it("omits firewall actions when the helper is absent from the stage", () => {
    const root = mkdtempSync(path.join(tmpdir(), "privgate-wxs-nofw-"));
    dirs.push(root);
    const stage = path.join(root, "stage");
    mkdirSync(stage);
    writeFileSync(path.join(stage, "service-ctl.cmd"), "@echo off\r\n");
    const out = path.join(root, "privgate.wxs");

    const result = spawnSync(process.execPath, [generateWxs, stage, out, "2.3.4"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);

    const xml = readFileSync(out, "utf8");
    expect(xml).not.toContain("AddConsoleFirewall");
    expect(xml).not.toContain("RemoveConsoleFirewall");
    expect(xml).not.toContain("filFirewallConsole");
  });
});
