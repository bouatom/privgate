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

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Reject path traversal (`../`, `..\`, absolute drive/root paths) and NUL. */
function hasTraversal(value: string): boolean {
  return /(^|[\\/])\.\.?([\\/]|$)/.test(value) || /^[a-zA-Z]:[\\/]/.test(value) || value.includes("\u0000");
}

/**
 * Server-authoritative validation of a policy's free-text target/bind fields.
 * Returns a human-readable error string when invalid, or null when acceptable.
 * Guards the M-2 finding: malformed bind/fileName values (including path
 * traversal like `../../etc/passwd`) must never reach the policy store.
 */
export function assertPolicyTargetfield(input: {
  name?: string;
  bindType?: Policy["bindType"];
  bindId?: string;
  fileName?: string;
  fileHash?: string;
  publisher?: string;
  argumentPattern?: string;
}): string | null {
  const { name, bindType, bindId } = input;

  if (name !== undefined) {
    if (!name.trim()) return "name is required";
    if (name.length > 200) return "name must be 200 characters or fewer";
    if (CONTROL_CHARS.test(name)) return "name cannot contain control characters";
  }

  if ((bindType === "user" || bindType === "group" || bindType === "device") && bindId !== undefined) {
    if (!bindId.trim()) return `${bindType} bind requires a bindId`;
    if (hasTraversal(bindId)) return `${bindType} bindId cannot contain path traversal`;
    // Require a UUID where one is expected; otherwise fall back to a safe
    // non-empty string (e.g. a device hostname or directory group name).
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(bindId) && !/^[A-Za-z0-9_.\- ]+$/.test(bindId)) {
      return `${bindType} bindId must be a UUID or a safe string`;
    }
  }

  if (input.fileName !== undefined && hasTraversal(input.fileName)) {
    return "fileName cannot contain path traversal or NUL bytes";
  }

  return null;
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
