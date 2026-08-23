import "server-only";
import { createHash, randomUUID } from "node:crypto";
import {
  activeJit,
  appendAudit,
  findUserBySid,
  getDevice,
  getRequest,
  groupIdsForUser,
  insertRequest,
  listPolicies,
  type DirectoryUser,
} from "./db";
import { evaluateElevation, type Decision } from "./policy";
import { assessRisk, type RiskLevel } from "./risk";
import { queueNotification, requestNotifyEvent } from "./notify";
import { deviceTicketKey, signTicket, type ElevationTicket } from "./signing";
import { ticketSigningKey } from "./secrets";
import { notifyPendingRequest } from "./realtime/notify";
import type { DatabaseSync } from "node:sqlite";

export type EvaluateBody = {
  userSid: string;
  entraOid?: string;
  filePath: string;
  fileHash: string;
  publisher: string;
  arguments?: string;
};

/**
 * Ticket signing key scoped to one enrolled device. The endpoint stores this
 * derived value, so a key lifted off one PC cannot sign tickets for another.
 */
export function ticketKeyForDevice(deviceId: string): string {
  return deviceTicketKey(ticketSigningKey(), deviceId);
}

export function getJitStateForDevice(db: DatabaseSync, deviceId: string, userSid: string) {
  const user = findUserBySid(db, userSid);
  if (!user) return { active: false as const, grant: null, userSid };
  const grant = activeJit(db, user.id, deviceId);
  return { active: Boolean(grant), grant: grant ?? null, userSid: user.adSid || userSid };
}

export function evaluateForDevice(
  db: DatabaseSync,
  deviceId: string,
  body: EvaluateBody,
): {
  decision: Decision["decision"];
  reason: string;
  requestId?: string;
  ticket?: string;
  user?: DirectoryUser;
  riskLevel: RiskLevel;
  riskReasons: string[];
} {
  const user = findUserBySid(db, body.userSid, body.entraOid);
  if (!user) {
    return {
      decision: "deny",
      reason: "unknown directory user",
      riskLevel: "high",
      riskReasons: ["Unknown directory user"],
    };
  }
  const jit = activeJit(db, user.id, deviceId);
  const decision = evaluateElevation(
    {
      userId: user.id,
      userSid: user.adSid,
      entraOid: user.entraOid,
      groupIds: groupIdsForUser(db, user.id),
      deviceId,
      disabled: user.disabled === 1,
    },
    {
      filePath: body.filePath,
      fileHash: body.fileHash,
      publisher: body.publisher,
      arguments: body.arguments,
    },
    listPolicies(db),
    Boolean(jit),
  );

  const risk = assessRisk({
    filePath: body.filePath,
    fileHash: body.fileHash,
    publisher: body.publisher,
    arguments: body.arguments,
    allowlisted: decision.decision === "allow" && !jit,
    jit: Boolean(jit),
  });

  if (decision.decision === "allow") {
    const now = Math.floor(Date.now() / 1000);
    const ticket: ElevationTicket = {
      typ: jit ? "jit" : "elevate",
      sub: user.adSid || user.entraOid,
      dev: deviceId,
      sha256: body.fileHash.toLowerCase(),
      publisher: body.publisher,
      path: body.filePath,
      child: decision.child,
      nbf: now - 5,
      exp: now + (jit ? 120 : 15 * 60),
      nonce: randomUUID(),
    };
    appendAudit(db, `device:${deviceId}`, "evaluate.allow", body.filePath, {
      user: user.userPrincipalName,
      reason: decision.reason,
      risk: risk.level,
    });
    return {
      decision: "allow",
      reason: decision.reason,
      ticket: signTicket(ticket, ticketKeyForDevice(deviceId)),
      user,
      riskLevel: risk.level,
      riskReasons: risk.reasons,
    };
  }

  if (decision.decision === "deny") {
    appendAudit(db, `device:${deviceId}`, "evaluate.deny", body.filePath, {
      user: user.userPrincipalName,
      reason: decision.reason,
      risk: risk.level,
    });
    return {
      decision: "deny",
      reason: decision.reason,
      user,
      riskLevel: risk.level,
      riskReasons: risk.reasons,
    };
  }

  const req = insertRequest(db, {
    userId: user.id,
    deviceId,
    filePath: body.filePath,
    fileHash: body.fileHash.toLowerCase(),
    publisher: body.publisher,
    arguments: body.arguments ?? "",
    riskLevel: risk.level,
    riskReasons: JSON.stringify(risk.reasons),
  });
  appendAudit(db, `device:${deviceId}`, "evaluate.pending", req.id, {
    user: user.userPrincipalName,
    file: body.filePath,
    risk: risk.level,
  });
  queueNotification(db, requestNotifyEvent("pending", { ...req, riskLevel: risk.level }, db));
  notifyPendingRequest(req);
  return {
    decision: "pending",
    reason: decision.reason,
    requestId: req.id,
    user,
    riskLevel: risk.level,
    riskReasons: risk.reasons,
  };
}

export function approvedTicket(db: DatabaseSync, requestId: string) {
  const req = getRequest(db, requestId);
  if (!req || req.status !== "approved") return undefined;
  if (req.approvalExpiresAt && new Date(req.approvalExpiresAt).getTime() <= Date.now()) {
    return undefined;
  }
  const user = findUserBySid(
    db,
    (db.prepare("SELECT ad_sid FROM users WHERE id = ?").get(req.userId) as { ad_sid: string }).ad_sid,
  );
  if (!user) return undefined;
  const now = Math.floor(Date.now() / 1000);
  const ticket: ElevationTicket = {
    typ: "elevate",
    sub: user.adSid || user.entraOid,
    dev: req.deviceId,
    sha256: req.fileHash,
    publisher: req.publisher,
    path: req.filePath,
    child: "deny",
    nbf: now - 5,
    exp: Math.floor(new Date(req.approvalExpiresAt ?? Date.now()).getTime() / 1000),
    nonce: randomUUID(),
  };
  return signTicket(ticket, ticketKeyForDevice(req.deviceId));
}

export function bodySha256(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

export function requireDevice(db: DatabaseSync, deviceId: string) {
  const device = getDevice(db, deviceId);
  if (!device) throw new Error("unknown device");
  return device;
}
