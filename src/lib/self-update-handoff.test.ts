import { describe, expect, it } from "vitest";
import {
  WINDOWS_UPDATE_TASK,
  buildWindowsUpdateTaskXml,
  createUpdateTaskArgs,
  runUpdateTaskArgs,
  schtasksPath,
  writeTaskXml,
} from "./self-update-handoff";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Windows scheduled-task handoff", () => {
  it("points schtasks at System32 and names a single one-shot task", () => {
    expect(schtasksPath("C:\\Windows")).toBe("C:\\Windows\\System32\\schtasks.exe");
    expect(createUpdateTaskArgs("C:\\data\\updates\\update-task.xml")).toEqual([
      "/Create",
      "/TN",
      WINDOWS_UPDATE_TASK,
      "/XML",
      "C:\\data\\updates\\update-task.xml",
      "/F",
    ]);
    expect(runUpdateTaskArgs()).toEqual(["/Run", "/TN", WINDOWS_UPDATE_TASK]);
  });

  it("embeds SYSTEM, the updater script, installer, hash, and data dir", () => {
    const xml = buildWindowsUpdateTaskXml({
      powershell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      scriptPath: "C:\\Program Files\\PrivGate\\update-server.ps1",
      installerPath: "C:\\ProgramData\\PrivGate\\updates\\PrivGate-Console-0.3.3-win-x64.exe",
      sha256: "a".repeat(64),
      dataDir: "C:\\ProgramData\\PrivGate",
    });
    expect(xml).toContain("S-1-5-18");
    expect(xml).toContain("HighestAvailable");
    expect(xml).toContain("update-server.ps1");
    expect(xml).toContain("PrivGate-Console-0.3.3-win-x64.exe");
    expect(xml).toContain("a".repeat(64));
    expect(xml).toContain("-DataDir");
    expect(xml).toContain("C:\\ProgramData\\PrivGate");
    expect(xml).toContain("&quot;C:\\Program Files\\PrivGate\\update-server.ps1&quot;");
  });

  it("declares no encoding (schtasks on Server 2022 rejects encoding= declarations)", () => {
    const xml = buildWindowsUpdateTaskXml({
      powershell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      scriptPath: "C:\\Program Files\\PrivGate\\update-server.ps1",
      installerPath: "C:\\ProgramData\\PrivGate\\updates\\PrivGate-Console-0.3.3-win-x64.exe",
      sha256: "a".repeat(64),
      dataDir: "C:\\ProgramData\\PrivGate",
    });
    expect(xml.startsWith('<?xml version="1.0"?>')).toBe(true);
    expect(xml).not.toContain("encoding=");
  });

  it("writes task XML as UTF-16LE with BOM and no encoding declaration", () => {
    const dir = mkdtempSync(join(tmpdir(), "privgate-handoff-"));
    const xmlPath = join(dir, "update-task.xml");
    try {
      writeTaskXml(xmlPath, '<?xml version="1.0"?>\n<Task version="1.2"/>');
      const bytes = readFileSync(xmlPath);
      // UTF-16LE BOM: FF FE. Decode as UTF-16LE and confirm the clean header.
      expect(bytes[0]).toBe(0xff);
      expect(bytes[1]).toBe(0xfe);
      const text = bytes.toString("utf16le");
      expect(text.startsWith("\uFEFF<?xml version=\"1.0\"?>")).toBe(true);
      expect(text).not.toContain("encoding=");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
