import "server-only";
import { getDb, getJit, findUserBySid, activeJit, revokeJit } from "../db";
import { evaluateForDevice, type EvaluateBody } from "../evaluate";

export type AgentRpc =
  | { id?: string; type: "ping" }
  | { id?: string; type: "evaluate"; body: EvaluateBody }
  | { id?: string; type: "jit-state"; userSid: string }
  | { id?: string; type: "jit-expired"; grantId: string };

export function handleAgentRpc(
  deviceId: string,
  message: AgentRpc,
): { id?: string; type: string; ok?: boolean; payload?: unknown; error?: string } {
  if (message.type === "ping") {
    return { id: message.id, type: "pong" };
  }
  if (message.type === "evaluate") {
    const body = message.body;
    if (!body?.userSid || !body.filePath || !body.fileHash || !body.publisher) {
      return { id: message.id, type: "result", ok: false, error: "userSid, filePath, fileHash, publisher required" };
    }
    const payload = evaluateForDevice(getDb(), deviceId, body);
    return { id: message.id, type: "result", ok: true, payload };
  }
  if (message.type === "jit-state") {
    const db = getDb();
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
  return { id: (message as { id?: string }).id, type: "result", ok: false, error: "unknown message" };
}
