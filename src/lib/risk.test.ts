import { describe, expect, it } from "vitest";
import { assessRisk } from "./risk";

describe("assessRisk", () => {
  it("marks allowlisted signed installers as low", () => {
    const r = assessRisk({
      filePath: "C:\\\\Program Files\\\\Contoso\\\\WidgetSetup.msi",
      fileHash: "abc",
      publisher: "CN=Contoso Code Signing",
      allowlisted: true,
    });
    expect(r.level).toBe("low");
  });

  it("marks PowerShell as critical", () => {
    const r = assessRisk({
      filePath: "C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe",
      fileHash: "x",
      publisher: "CN=Microsoft Windows",
    });
    expect(r.level).toBe("critical");
    expect(r.reasons.join(" ")).toMatch(/LOLBin|Interpreter/i);
  });

  it("raises unsigned files in Downloads", () => {
    const r = assessRisk({
      filePath: "C:\\\\Users\\\\riley\\\\Downloads\\\\update.exe",
      fileHash: "dead",
      publisher: "",
    });
    expect(r.level).toBe("high");
    expect(r.reasons.some((x) => /unsigned|publisher/i.test(x))).toBe(true);
    expect(r.reasons.some((x) => /user-writable/i.test(x))).toBe(true);
  });

  it("flags encoded PowerShell arguments as critical", () => {
    const r = assessRisk({
      filePath: "C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe",
      fileHash: "x",
      publisher: "CN=Microsoft Windows",
      arguments: "-EncodedCommand aGVsbG8=",
    });
    expect(r.level).toBe("critical");
  });
});
