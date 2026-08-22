import { isHardBanned, fileNameOf } from "./hard-bans";

export type PolicyEffect = "allow" | "deny" | "require_approval";

export type Policy = {
  id: string;
  name: string;
  effect: PolicyEffect;
  fileHash: string;
  publisher: string;
  fileName?: string;
  argumentPattern?: string;
  bindType: "all" | "user" | "group" | "device";
  bindId?: string;
  childProcesses: "deny" | "allow";
  highRiskException: boolean;
};

export type EvaluateSubject = {
  userId: string;
  userSid: string;
  entraOid?: string;
  groupIds: string[];
  deviceId: string;
  disabled?: boolean;
};

export type EvaluateFile = {
  filePath: string;
  fileHash: string;
  publisher: string;
  arguments?: string;
};

export type Decision =
  | { decision: "allow"; policyId: string; child: "deny" | "allow"; reason: string }
  | { decision: "deny"; reason: string; policyId?: string }
  | { decision: "pending"; reason: string };

function hashOk(policy: Policy, file: EvaluateFile): boolean {
  return policy.fileHash.toLowerCase() === file.fileHash.toLowerCase();
}

function publisherOk(policy: Policy, file: EvaluateFile): boolean {
  return policy.publisher.toLowerCase() === file.publisher.toLowerCase();
}

function nameOk(policy: Policy, file: EvaluateFile): boolean {
  if (!policy.fileName) return true;
  return fileNameOf(policy.fileName) === fileNameOf(file.filePath);
}

function argsOk(policy: Policy, file: EvaluateFile): boolean {
  if (!policy.argumentPattern) return true;
  const value = file.arguments ?? "";
  try {
    return new RegExp(policy.argumentPattern).test(value);
  } catch {
    return false;
  }
}

function bindOk(policy: Policy, subject: EvaluateSubject): boolean {
  switch (policy.bindType) {
    case "all":
      return true;
    case "user":
      return (
        policy.bindId === subject.userId ||
        policy.bindId === subject.userSid ||
        policy.bindId === subject.entraOid
      );
    case "group":
      return subject.groupIds.includes(policy.bindId ?? "");
    case "device":
      return policy.bindId === subject.deviceId;
    default:
      return false;
  }
}

function matches(policy: Policy, subject: EvaluateSubject, file: EvaluateFile): boolean {
  return (
    hashOk(policy, file) &&
    publisherOk(policy, file) &&
    nameOk(policy, file) &&
    argsOk(policy, file) &&
    bindOk(policy, subject)
  );
}

/** Filename without hash+publisher is never a match. */
export function evaluateElevation(
  subject: EvaluateSubject,
  file: EvaluateFile,
  policies: Policy[],
  jitActive: boolean,
): Decision {
  if (subject.disabled) {
    return { decision: "deny", reason: "user disabled" };
  }
  if (!file.fileHash || !file.publisher) {
    return { decision: "deny", reason: "hash and publisher are required" };
  }
  if (jitActive) {
    return { decision: "allow", policyId: "jit", child: "allow", reason: "active JIT window" };
  }
  if (isHardBanned(file.filePath)) {
    const exception = policies.find(
      (p) => matches(p, subject, file) && p.highRiskException && p.effect === "require_approval",
    );
    if (exception) {
      return { decision: "pending", reason: "hard-banned binary requires approval" };
    }
    return { decision: "deny", reason: "hard-banned binary" };
  }

  const matching = policies.filter((p) => matches(p, subject, file));
  if (matching.some((p) => p.effect === "deny")) {
    const deny = matching.find((p) => p.effect === "deny")!;
    return { decision: "deny", reason: "matched deny policy", policyId: deny.id };
  }
  const allow = matching.find((p) => p.effect === "allow");
  if (allow) {
    if (isHardBanned(file.filePath)) {
      return { decision: "deny", reason: "hard-banned binary cannot be always-allow" };
    }
    return {
      decision: "allow",
      policyId: allow.id,
      child: allow.childProcesses,
      reason: `allowlisted by ${allow.name}`,
    };
  }
  if (matching.some((p) => p.effect === "require_approval")) {
    return { decision: "pending", reason: "policy requires approval" };
  }
  return { decision: "pending", reason: "no matching allow policy" };
}

export function assertAllowPolicyInput(input: {
  effect: PolicyEffect;
  fileHash: string;
  publisher: string;
  fileName?: string;
  highRiskException?: boolean;
}): string | null {
  if (!input.fileHash || !input.publisher) {
    return "fileHash and publisher are required";
  }
  if (input.fileName && isHardBanned(input.fileName) && input.effect === "allow") {
    return "hard-banned binaries cannot be always-allow";
  }
  if (input.highRiskException && input.effect === "allow") {
    return "high-risk exceptions cannot be automatic allow";
  }
  return null;
}
