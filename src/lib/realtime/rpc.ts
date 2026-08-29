import "server-only";
import { getDb, getJit, findUserBySid, activeJit, revokeJit, getElevationSettings } from "../db";
import { evaluateForDevice, silentAllowForDevice, type EvaluateBody } from "../evaluate";
import { reconcileReportedVersion } from "../agent-update";
import { expireDueGrants } from "../db/jit";
import { appendAudit } from "../db/audit";
import { noteClientStatus } from "./bus";
import { handleUacCanceled, handleUacSeen } from "../uac-prompt";

export type AgentRpc =
  | { id?: string; type: "ping" }
  | { id?: string; type: "evaluate"; body: EvaluateBody }
  | { id?: string; type: "silent-allow"; body: EvaluateBody }
  | { id?: string; type: "jit-state"; userSid: string }
  | { id?: string; type: "jit-expired"; grantId: string }
  | { id?: string; type: "version-report"; version: string }
  | { id?: string; type: "client-status"; uptimeSec: number; pid: number }
  | { id?: string; type: "uac-seen"; userSid: string; filePath?: string; fileHash?: string; publisher?: string; arguments?: string }
  | {
      id?: string;
      type: "uac-canceled";
      userSid: string;
      filePath?: string;
      fileHash?: string;
      publisher?: string;
      arguments?: string;
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
    return {
      id: message.id,
      type: "result",
      ok: true,
      payload: { recorded: true, uacMode: getElevationSettings(getDb()).uacMode },
    };
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
  if (message.type === "uac-seen") {
    return handleUacSeen(deviceId, message);
  }
  if (message.type === "uac-canceled") {
    return handleUacCanceled(deviceId, message);
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
