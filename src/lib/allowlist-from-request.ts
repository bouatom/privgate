import { fileNameOf, isHardBanned } from "./hard-bans";
import type { Policy } from "./policy";

export type AllowlistSource = {
  filePath: string;
  fileHash: string;
  publisher: string;
  arguments?: string;
  hostname?: string;
  deviceId: string;
};

export function allowlistBlockedReason(filePath: string, fileHash: string, publisher: string): string | null {
  if (!filePath.trim() || filePath.trim() === "(unidentified program)") {
    return "The agent could not identify which program Windows asked about.";
  }
  if (!fileHash.trim() || !publisher.trim()) {
    return "Hash and publisher are required to create an always-allow rule.";
  }
  if (isHardBanned(filePath)) {
    return "Shells and scripting hosts cannot be always-allow.";
  }
  return null;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function argumentPatternFromArgs(args: string): string {
  return `^${escapeRegExp(args)}$`;
}

export function allowlistDraftFromRequest(source: AllowlistSource, scope: "device" | "all") {
  const fileName = fileNameOf(source.filePath);
  const argName = source.arguments?.trim() ? fileNameOf(source.arguments.replace(/^["']|["']$/g, "")) : "";
  const label = argName && argName !== fileName ? `${fileName} ${argName}` : fileName;
  const suffix = scope === "device" && source.hostname ? ` on ${source.hostname}` : "";
  return {
    name: `Always allow ${label}${suffix}`.slice(0, 120),
    effect: "allow" as const,
    fileHash: source.fileHash,
    publisher: source.publisher,
    fileName,
    argumentPattern: argumentPatternFromArgs(source.arguments ?? ""),
    bindType: (scope === "device" ? "device" : "all") as "device" | "all",
    bindId: scope === "device" ? source.deviceId : "",
    childProcesses: "deny" as const,
    highRiskException: false,
  };
}

export function allowPolicyCoversRequest(policy: Policy, source: AllowlistSource): boolean {
  if (policy.effect !== "allow") return false;
  if (policy.fileHash.toLowerCase() !== source.fileHash.toLowerCase()) return false;
  if (policy.publisher.toLowerCase() !== source.publisher.toLowerCase()) return false;
  if (policy.fileName && fileNameOf(policy.fileName) !== fileNameOf(source.filePath)) return false;
  if (policy.argumentPattern) {
    try {
      if (!new RegExp(policy.argumentPattern).test(source.arguments ?? "")) return false;
    } catch {
      return false;
    }
  }
  if (policy.bindType === "all") return true;
  if (policy.bindType === "device") return policy.bindId === source.deviceId;
  return false;
}
