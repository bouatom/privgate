import { describe, expect, it } from "vitest";
import {
  WINDOWS_UPDATE_TASK,
  buildWindowsUpdateTaskXml,
  createUpdateTaskArgs,
  runUpdateTaskArgs,
  schtasksPath,
} from "./self-update-handoff";

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
});
