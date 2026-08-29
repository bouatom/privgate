import "server-only";
import { getDb, findUserBySid } from "./db";
import { insertRequest } from "./db/requests";
import { appendAudit } from "./db/audit";
import { upsertUacPrompt } from "./db/uac-prompts";
import { publishConsole } from "./realtime/bus";

/** Classifier verdicts the console accepts on closed-prompt telemetry. */
export const UAC_OUTCOMES = ["approved-self", "approved-other", "escaped", "timeout", "unknown"] as const;

export type UacTelemetry = {
  id?: string;
  userSid: string;
  filePath?: string;
  fileHash?: string;
  publisher?: string;
  arguments?: string;
  outcome?: string;
};

function fields(message: UacTelemetry) {
  const filePath = String(message.filePath || "").trim().slice(0, 1024) || "(unidentified program)";
  const fileHash = /^[\da-fA-F]{64}$/.test(String(message.fileHash || "")) ? String(message.fileHash) : "";
  const publisher = String(message.publisher || "").trim().slice(0, 256);
  const args = String(message.arguments || "").trim().slice(0, 1024);
  const rawOutcome = typeof message.outcome === "string" ? message.outcome.trim() : "";
  const outcome = (UAC_OUTCOMES as readonly string[]).includes(rawOutcome) ? rawOutcome : "";
  return { filePath, fileHash, publisher, args, outcome };
}

export function handleUacSeen(
  deviceId: string,
  message: UacTelemetry,
): { id?: string; type: string; ok?: boolean; payload?: unknown; error?: string } {
  const db = getDb();
  const user = findUserBySid(db, message.userSid || "");
  if (!user) {
    return { id: message.id, type: "result", ok: false, error: "unknown directory user" };
  }
  const { filePath, fileHash, publisher, args } = fields(message);
  const row = upsertUacPrompt(db, {
    userId: user.id,
    deviceId,
    filePath,
    fileHash,
    publisher,
    arguments: args,
    lastOutcome: "prompted",
    phase: "seen",
  });
  if (row.created) {
    appendAudit(db, `device:${deviceId}`, "device.uac.prompted", deviceId, { filePath });
  }
  publishConsole("requests");
  publishConsole("devices");
  return { id: message.id, type: "result", ok: true, payload: { recorded: true } };
}

export function handleUacCanceled(
  deviceId: string,
  message: UacTelemetry,
): { id?: string; type: string; ok?: boolean; payload?: unknown; error?: string } {
  const db = getDb();
  const user = findUserBySid(db, message.userSid || "");
  if (!user) {
    return { id: message.id, type: "result", ok: false, error: "unknown directory user" };
  }
  const { filePath, fileHash, publisher, args, outcome } = fields(message);
  upsertUacPrompt(db, {
    userId: user.id,
    deviceId,
    filePath,
    fileHash,
    publisher,
    arguments: args,
    lastOutcome: outcome || "canceled",
    phase: "closed",
  });
  publishConsole("requests");
  publishConsole("devices");
  if (outcome === "approved-self" || outcome === "approved-other") {
    appendAudit(db, `device:${deviceId}`, "device.uac.approved", deviceId, { filePath, outcome });
    return { id: message.id, type: "result", ok: true, payload: { recorded: false } };
  }
  const dupe = db
    .prepare(
      `SELECT id FROM requests WHERE user_id = ? AND device_id = ? AND file_path = ? AND status = 'canceled'`,
    )
    .get(user.id, deviceId, filePath);
  if (!dupe) {
    insertRequest(db, {
      userId: user.id,
      deviceId,
      filePath,
      fileHash,
      publisher,
      arguments: args,
      status: "canceled",
      decidedBy: "user",
    });
    appendAudit(db, `device:${deviceId}`, "device.uac.canceled", deviceId, { filePath });
  }
  return { id: message.id, type: "result", ok: true, payload: { recorded: !dupe } };
}
