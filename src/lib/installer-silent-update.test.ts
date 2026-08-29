import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const nsi = readFileSync(path.join(ROOT, "packaging/windows/privgate.nsi"), "utf8");
const ctl = readFileSync(path.join(ROOT, "packaging/windows/service-ctl.cmd"), "utf8");
const ps1 = readFileSync(path.join(ROOT, "scripts/update-server.ps1"), "utf8");

describe("hands-free Windows self-update", () => {
  it("gives every NSIS MessageBox a silent default so /S cannot hang Session 0", () => {
    const boxes = nsi.match(/^[\t ]*MessageBox\b/gm) ?? [];
    const silent = nsi.match(/\/SD\s+ID(?:OK|CANCEL|ABORT|YES|NO)/g) ?? [];
    expect(boxes.length).toBeGreaterThan(0);
    expect(silent.length).toBe(boxes.length);
  });

  it("aborts a silent upgrade when stop-all fails instead of waiting on OK/Cancel", () => {
    expect(nsi).toMatch(/MessageBox MB_ICONEXCLAMATION\|MB_OKCANCEL[\s\S]*?\/SD IDCANCEL/);
  });

  it("passes the install dir to PowerShell via env, not a trailing -Command argument", () => {
    expect(ctl).toContain("$env:PRIVGATE_CTLDIR");
    expect(ctl).not.toMatch(/\$args\[0\]/);
    expect(ctl).not.toMatch(/exit 0" "%CTLDIR%"/);
  });

  it("stops the console before running the installer and ignores a stale sibling sums file", () => {
    const installer = ps1.slice(ps1.indexOf("'ByInstaller'"));
    const stopAt = installer.indexOf("Stop-Console");
    const startAt = installer.search(/Start-Process (?:msiexec\.exe|\$Installer)/);
    expect(stopAt).toBeGreaterThan(0);
    expect(startAt).toBeGreaterThan(stopAt);
    expect(ps1).toContain("Skipping sibling sha256sums.txt; -Sha256 already verified the installer");
    expect(ps1).toMatch(/robocopy .* \/R:2 \/W:1/);
  });
});
