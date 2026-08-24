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
    // msiexec raises FilesInUse and silent updates fail.
    expect(xml).toContain('Id="StopPrivGateStray"');
    expect(xml).toMatch(/<Custom Action="StopPrivGateStray" Before="InstallValidate">NOT REMOVE<\/Custom>/);
    expect(xml).toContain("MajorUpgrade");
  });
});
