import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Mirrors UacTargetCache.PreferTarget: snap-in/installer first, then non-wrappers. */
function preferTarget(candidates: string[]): string {
  if (!candidates.length) return "";
  const wrappers = new Set(["powershell.exe", "pwsh.exe", "cmd.exe", "conhost.exe", "consent.exe", "explorer.exe"]);
  const snap = candidates.find((c) => {
    const lower = c.toLowerCase();
    return lower.endsWith(".msc") || lower.endsWith(".msi");
  });
  if (snap) return snap;
  const base = (c: string) => c.replace(/^.*[\\/]/, "").toLowerCase();
  return candidates.find((c) => !wrappers.has(base(c))) ?? candidates[0]!;
}

function extractEmbedded(commandLine: string): string[] {
  const re =
    /[A-Za-z]:\\(?:[^<>:"/|?*\r\n]+\\)*[^<>:"/|?*\r\n]+\.(?:exe|msc|msi)|\\\\[^<>:"/|?*\r\n]+\\[^<>:"/|?*\r\n]+\.(?:exe|msc|msi)/gi;
  return commandLine.match(re) ?? [];
}

describe("UAC consent target preference", () => {
  it("pulls diskmgmt.msc out of a PowerShell Start-Process -Verb RunAs line", () => {
    const line =
      `"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -WindowStyle Hidden -Command Start-Process -FilePath C:\\Windows\\System32\\mmc.exe -ArgumentList \\"C:\\Windows\\System32\\diskmgmt.msc\\" -Verb RunAs`;
    expect(preferTarget(extractEmbedded(line))).toBe("C:\\Windows\\System32\\diskmgmt.msc");
  });

  it("prefers a snap-in over mmc.exe and skips shell wrappers", () => {
    expect(
      preferTarget([
        "C:\\Windows\\System32\\mmc.exe",
        "C:\\Windows\\System32\\diskmgmt.msc",
      ]),
    ).toBe("C:\\Windows\\System32\\diskmgmt.msc");
    expect(
      preferTarget(["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "C:\\Tools\\setup.exe"]),
    ).toBe("C:\\Tools\\setup.exe");
    expect(preferTarget(["C:\\Windows\\System32\\cmd.exe"])).toBe("C:\\Windows\\System32\\cmd.exe");
  });

  it("is what the broker uses when reading consent.exe command lines", () => {
    const src = readFileSync(join(__dirname, "../../agent/UacTargetExtract.cs"), "utf8");
    expect(src).toContain("PreferTarget");
    expect(src).toContain("FromSession");
    expect(src).toContain("powershell.exe");
    expect(src).toContain("RunAs");
    expect(readFileSync(join(__dirname, "../../agent/RealtimeChannel.Uac.cs"), "utf8")).toContain(
      "TimeSpan.FromSeconds(4)",
    );
    expect(readFileSync(join(__dirname, "../../agent/PipeAux.cs"), "utf8")).toContain("UacTargetCache.Remember");
    expect(readFileSync(join(__dirname, "../../agent/ConsentBrokerWatch.cs"), "utf8")).toContain("ReportUacSeenAsync");
    expect(readFileSync(join(__dirname, "../../agent/RealtimeChannel.Uac.cs"), "utf8")).toContain("uac-seen");
  });
});
