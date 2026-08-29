import "server-only";
import { getDb, getJit, findUserBySid, activeJit, revokeJit } from "../db";
import { evaluateForDevice, silentAllowForDevice, type EvaluateBody } from "../evaluate";
import { reconcileReportedVersion } from "../agent-update";
import { insertRequest } from "../db/requests";
import { appendAudit } from "../db/audit";
import { expireDueGrants } from "../db/jit";
import { noteClientStatus } from "./bus";

export type AgentRpc =
  | { id?: string; type: "ping" }
  | { id?: string; type: "evaluate"; body: EvaluateBody }
  | { id?: string; type: "silent-allow"; body: EvaluateBody }
  | { id?: string; type: "jit-state"; userSid: string }
  | { id?: string; type: "jit-expired"; grantId: string }
  | { id?: string; type: "version-report"; version: string }
  | { id?: string; type: "client-status"; uptimeSec: number; pid: number }
  | {
      id?: string;
      type: "uac-canceled";
      userSid: string;
      filePath?: string;
      fileHash?: string;
      publisher?: string;
      outcome?: string;
    }
  | {
      id?: string;
      type: "launch-result";
      requestId?: string;
      filePath: string;
      ok: boolean;
      detail?: string;
    };

/** Classifier verdicts the console accepts on uac-canceled telemetry. */
const UAC_OUTCOMES = ["approved-self", "approved-other", "escaped", "timeout", "unknown"];

/** GUI heartbeat sanity window: 0..30 days of tray uptime. */
const MAX_UPTIME_SEC = 30 * 24 * 3600;

/** Length caps for launch-result free-text fields (device-controlled strings). */
const LAUNCH_MAX_REQUEST_ID = 128;
const LAUNCH_MAX_FILE_PATH = 1024;
const LAUNCH_MAX_DETAIL = 512;

export function handleAgentRpc(
  deviceId: string,
  message: AgentRpc,
): { id?: string; type: string; ok?: boolean; payload?: unknown; error?: string } {
  if (message.type === "ping") {
    return { id: message.id, type: "pong" };
  }
  if (message.type === "client-status") {
    const uptime = message.uptimeSec;
    const pid = message.pid;
    const valid =
      typeof uptime === "number" &&
      Number.isFinite(uptime) &&
      uptime >= 0 &&
      uptime <= MAX_UPTIME_SEC &&
      Number.isInteger(pid) &&
      pid > 0 &&
      pid <= 0xffffffff;
    if (!valid) {
      return { id: message.id, type: "result", ok: false, error: "uptimeSec/pid invalid" };
    }
    noteClientStatus(deviceId, Math.floor(uptime), pid);
    return { id: message.id, type: "result", ok: true, payload: { recorded: true } };
  }
  if (message.type === "evaluate") {
    const body = message.body;
    if (!body?.userSid || !body.filePath || !body.fileHash) {
      return { id: message.id, type: "result", ok: false, error: "userSid, filePath, fileHash, publisher required" };
    }
    const payload = evaluateForDevice(getDb(), deviceId, {
      ...body,
      publisher: (body.publisher || "").trim() || "Unknown",
    });
    return { id: message.id, type: "result", ok: true, payload };
  }
  if (message.type === "silent-allow") {
    const body = message.body;
    if (!body?.userSid || !body.filePath || !body.fileHash) {
      return { id: message.id, type: "result", ok: false, error: "userSid, filePath, fileHash, publisher required" };
    }
    const payload = silentAllowForDevice(getDb(), deviceId, {
      ...body,
      publisher: (body.publisher || "").trim() || "Unknown",
    });
    return { id: message.id, type: "result", ok: true, payload };
  }
  if (message.type === "jit-state") {
    const db = getDb();
    expireDueGrants(db);
    const user = findUserBySid(db, message.userSid || "");
    if (!user) {
      return { id: message.id, type: "result", ok: true, payload: { active: false } };
    }
    const grant = activeJit(db, user.id, deviceId);
    return {
      id: message.id,
      type: "result",
      ok: true,
      payload: { active: Boolean(grant), grant: grant ?? null, userSid: user.adSid },
    };
  }
  if (message.type === "jit-expired") {
    const db = getDb();
    const grant = getJit(db, message.grantId);
    if (!grant || grant.deviceId !== deviceId) {
      return { id: message.id, type: "result", ok: false, error: "unknown grant" };
    }
    revokeJit(db, message.grantId, `device:${deviceId}`);
    return { id: message.id, type: "result", ok: true, payload: { ok: true } };
  }
  if (message.type === "version-report") {
    const version = String(message.version || "").trim();
    if (!version || !/^[\w.\-+]{1,64}$/.test(version)) {
      return { id: message.id, type: "result", ok: false, error: "invalid version" };
    }
    reconcileReportedVersion(getDb(), deviceId, version);
    return { id: message.id, type: "result", ok: true, payload: { version } };
  }
  if (message.type === "uac-canceled") {
    const db = getDb();
    const user = findUserBySid(db, message.userSid || "");
    if (!user) {
      return { id: message.id, type: "result", ok: false, error: "unknown directory user" };
    }
    const filePath = String(message.filePath || "").trim().slice(0, 1024) || "(unidentified program)";
    const fileHash = /^[\da-fA-F]{64}$/.test(String(message.fileHash || "")) ? String(message.fileHash) : "";
    const publisher = String(message.publisher || "").trim().slice(0, 256);
    // Classifier verdict from the broker service; anything outside the
    // whitelist degrades to absent so legacy agents behave exactly as before.
    const rawOutcome = typeof message.outcome === "string" ? message.outcome.trim() : "";
    const outcome = UAC_OUTCOMES.includes(rawOutcome) ? rawOutcome : "";
    // An administrator approved the prompt themselves: record the observation
    // audit-only. No fake canceled request row, no queue pollution.
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
        arguments: "",
        status: "canceled",
        decidedBy: "user",
      });
      appendAudit(db, `device:${deviceId}`, "device.uac.canceled", deviceId, { filePath });
    }
    return { id: message.id, type: "result", ok: true, payload: { recorded: !dupe } };
  }
  if (message.type === "launch-result") {
    // Strict validation: `ok` must be a real boolean (no truthy strings), and
    // every device-controlled string is trimmed and length-capped before it
    // reaches the audit log.
    if (typeof message.ok !== "boolean") {
      return { id: message.id, type: "result", ok: false, error: "ok boolean required" };
    }
    const requestId =
      typeof message.requestId === "string"
        ? message.requestId.trim().slice(0, LAUNCH_MAX_REQUEST_ID)
        : "";
    const filePath = String(message.filePath || "").trim().slice(0, LAUNCH_MAX_FILE_PATH);
    const detail = typeof message.detail === "string" ? message.detail.trim().slice(0, LAUNCH_MAX_DETAIL) : "";
    // Additive telemetry only — evaluate.ts's mint-time audit is untouched.
    appendAudit(
      getDb(),
      `device:${deviceId}`,
      "device.launch." + (message.ok ? "succeeded" : "failed"),
      deviceId,
      { requestId, filePath, detail },
    );
    return { id: message.id, type: "result", ok: true, payload: { recorded: true } };
  }
  return { id: (message as { id?: string }).id, type: "result", ok: false, error: "unknown message" };
}
