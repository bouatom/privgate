import type { AllowlistSource } from "./allowlist-from-request";
import { allowPolicyCoversRequest, argumentPatternFromArgs } from "./allowlist-from-request";
import type { ElevationRequest } from "./db/types";
import { fileNameOf, isHardBanned } from "./hard-bans";
import type { Policy, PolicyEffect } from "./policy";

/**
 * Semantics of the hand-written program-rule form: how a draft turns into a
 * POST /api/policies body, its validation rules, and how a draft would have
 * matched recent elevation requests. Pure and browser-safe so the client
 * components and the API route share one definition.
 */

export type ArgumentMode = "literal" | "regex";

export type RuleDraft = {
  name: string;
  effect: PolicyEffect;
  fileHash: string;
  publisher: string;
  fileName: string;
  argumentsText: string;
  argumentMode: ArgumentMode;
  bindType: "all" | "group";
  bindId: string;
};

export function emptyRuleDraft(): RuleDraft {
  return {
    name: "",
    effect: "allow",
    fileHash: "",
    publisher: "",
    fileName: "",
    argumentsText: "",
    argumentMode: "literal",
    bindType: "all",
    bindId: "",
  };
}

/**
 * Literal mode anchors the whole argument string and escapes regex syntax,
 * so typed text matches literally (wildcards silently never match otherwise).
 * Regex mode stores the raw expression. Empty text means "any arguments".
 */
export function argumentPatternFromDraft(text: string, mode: ArgumentMode): string {
  const value = text.trim();
  if (!value) return "";
  return mode === "literal" ? argumentPatternFromArgs(value) : value;
}

/** Server-authoritative check that an advanced-mode regex compiles. */
export function argumentPatternError(pattern: string | undefined): string | null {
  if (!pattern) return null;
  try {
    new RegExp(pattern);
    return null;
  } catch {
    return "Arguments must match: not a valid regular expression.";
  }
}

export function effectError(effect: string | undefined): string | null {
  if (!effect || effect === "allow" || effect === "deny" || effect === "require_approval") return null;
  return "Unknown effect. Use allow, deny, or require_approval.";
}

/** Body for POST /api/policies; doubles as the input for the match preview. */
export function ruleDraftToPolicyBody(draft: RuleDraft): Omit<Policy, "id"> {
  const argumentPattern = argumentPatternFromDraft(draft.argumentsText, draft.argumentMode);
  return {
    name: draft.name.trim(),
    effect: draft.effect,
    fileHash: draft.fileHash.trim(),
    publisher: draft.publisher.trim(),
    fileName: draft.fileName.trim() || undefined,
    argumentPattern: argumentPattern || undefined,
    bindType: draft.bindType,
    bindId: draft.bindType === "all" ? "" : draft.bindId,
    childProcesses: "deny",
    highRiskException: false,
  };
}

/** Minimal recorded-request shape needed to run the matcher and label rows. */
export type PreviewableRequest = Pick<
  ElevationRequest,
  "id" | "userId" | "deviceId" | "filePath" | "fileHash" | "publisher" | "arguments" | "requestedAt"
> & { userName: string; hostname: string };

/** userId -> directory group ids, so group-bound rules resolve per request. */
export type UserGroupIds = Record<string, string[]>;

export type PreviewVerdict = {
  request: PreviewableRequest;
  /** File criteria (hash, publisher, name, arguments) AND scope all hold. */
  matches: boolean;
  /** First criterion that failed, in engine order; "" when matched. */
  missed: string;
};

function requestSource(request: PreviewableRequest): AllowlistSource {
  return {
    filePath: request.filePath,
    fileHash: request.fileHash,
    publisher: request.publisher,
    arguments: request.arguments,
    deviceId: request.deviceId,
  };
}

function scopeHolds(body: Omit<Policy, "id">, request: PreviewableRequest, userGroupIds: UserGroupIds): boolean {
  if (body.bindType === "all") return true;
  if (body.bindType === "device") return body.bindId === request.deviceId;
  if (!body.bindId) return false;
  return (userGroupIds[request.userId] ?? []).includes(body.bindId);
}

function scopeMissLabel(bindType: Policy["bindType"]): string {
  return bindType === "device" ? "bound to a different PC" : "user is not in the bound group";
}

/** Presentation-level triage mirroring policy.ts comparison order. */
function firstMissedCriterion(body: Omit<Policy, "id">, request: PreviewableRequest): string {
  if (request.fileHash.toLowerCase() !== body.fileHash.toLowerCase()) return "hash differs";
  if (request.publisher.toLowerCase() !== body.publisher.toLowerCase()) return "publisher differs";
  if (body.fileName && fileNameOf(body.fileName) !== fileNameOf(request.filePath)) return "file name differs";
  return "arguments do not match";
}

/**
 * Would this draft rule have matched each recorded request?
 *
 * Matching criteria are effect-independent, but allowPolicyCoversRequest gates
 * on effect:"allow", so we probe with a normalized copy and strip the bind —
 * scope is resolved separately so group-bound rules get real answers instead
 * of a blanket "no".
 */
export function previewRuleAgainstRequests(
  body: Omit<Policy, "id">,
  requests: PreviewableRequest[],
  userGroupIds: UserGroupIds = {},
): PreviewVerdict[] {
  const probe: Policy = {
    ...body,
    id: "draft-preview",
    effect: "allow",
    bindType: "all",
    bindId: "",
    childProcesses: "deny",
    highRiskException: false,
  };
  return requests.map((request) => {
    const fileOk = allowPolicyCoversRequest(probe, requestSource(request));
    const scopeOk = scopeHolds(body, request, userGroupIds);
    return {
      request,
      matches: fileOk && scopeOk,
      missed: fileOk ? (scopeOk ? "" : scopeMissLabel(body.bindType)) : firstMissedCriterion(body, request),
    };
  });
}

export type VerdictKind = "allow" | "deny" | "require_approval" | "hard-banned" | "miss";

/** What the engine would decide for a request under this draft's effect. */
export function describeVerdict(body: Omit<Policy, "id">, verdict: PreviewVerdict): { kind: VerdictKind; label: string } {
  if (!verdict.matches) {
    return { kind: "miss", label: `No match — ${verdict.missed || "criteria differ"}` };
  }
  // Hard bans are checked before any policy applies, and this form cannot
  // create high-risk exceptions, so a match still ends blocked.
  if (isHardBanned(verdict.request.filePath)) {
    return { kind: "hard-banned", label: "Blocked anyway — hard-banned binary" };
  }
  switch (body.effect) {
    case "deny":
      return { kind: "deny", label: "Match — would be denied" };
    case "require_approval":
      return { kind: "require_approval", label: "Match — would need approval" };
    default:
      return { kind: "allow", label: "Match — would elevate silently" };
  }
}
