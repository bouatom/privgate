import { isHardBanned, fileNameOf } from "./hard-bans";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type RiskAssessment = {
  level: RiskLevel;
  score: number;
  reasons: string[];
};

const LOLBINS = new Set([
  ...["cmd.exe", "powershell.exe", "pwsh.exe", "wscript.exe", "mshta.exe", "reg.exe"],
  "cscript.exe",
  "rundll32.exe",
  "regsvr32.exe",
  "msiexec.exe",
  "certutil.exe",
  "bitsadmin.exe",
]);

const SUSPICIOUS_PATHS = [
  "\\users\\",
  "/users/",
  "\\downloads\\",
  "/downloads/",
  "\\appdata\\",
  "/appdata/",
  "\\temp\\",
  "/temp/",
  "\\desktop\\",
  "/desktop/",
];

function bump(level: RiskLevel, next: RiskLevel): RiskLevel {
  const order: RiskLevel[] = ["low", "medium", "high", "critical"];
  return order[Math.max(order.indexOf(level), order.indexOf(next))]!;
}

export function assessRisk(input: {
  filePath: string;
  fileHash: string;
  publisher: string;
  arguments?: string;
  allowlisted?: boolean;
  jit?: boolean;
}): RiskAssessment {
  const reasons: string[] = [];
  let level: RiskLevel = "low";
  let score = 10;
  const name = fileNameOf(input.filePath);
  const path = input.filePath.toLowerCase().replaceAll("/", "\\");

  if (input.jit) {
    reasons.push("JIT window grants full local admin, not a single program");
    level = bump(level, "high");
    score += 35;
  }

  if (isHardBanned(input.filePath) || LOLBINS.has(name)) {
    reasons.push(`Interpreter or LOLBin (${name}) can run arbitrary commands`);
    level = bump(level, "critical");
    score += 50;
  }

  if (!input.publisher || input.publisher === "dry-run") {
    reasons.push("No Authenticode publisher — file may be unsigned or swapped");
    level = bump(level, "high");
    score += 30;
  }

  if (!input.fileHash) {
    reasons.push("Missing file hash");
    level = bump(level, "high");
    score += 20;
  }

  if (SUSPICIOUS_PATHS.some((p) => path.includes(p))) {
    reasons.push("Path is in a user-writable location (Downloads, AppData, Temp, Desktop)");
    level = bump(level, "high");
    score += 25;
  }

  if (/\.(ps1|vbs|js|bat|cmd|hta)$/i.test(name)) {
    reasons.push("Script file, not a signed installer");
    level = bump(level, "critical");
    score += 40;
  }

  const args = (input.arguments ?? "").toLowerCase();
  if (args.includes("-enc") || args.includes("-encodedcommand") || args.includes("iex") || args.includes("downloadstring")) {
    reasons.push("Arguments look like encoded or download-execute PowerShell");
    level = bump(level, "critical");
    score += 40;
  }

  if (input.allowlisted && level !== "critical") {
    reasons.push("Matches an always-allow policy (hash + publisher)");
    if (level === "low") score = Math.min(score, 15);
  }

  if (reasons.length === 0) {
    reasons.push("Signed binary with no suspicious path or arguments");
  }

  score = Math.min(100, score);
  return { level, score, reasons };
}

export function riskLabel(level: RiskLevel): string {
  switch (level) {
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
    case "critical":
      return "Critical";
  }
}
