import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { appendAudit, getDevice } from "./db";
import { setDeviceAgentVersion } from "./db/devices";
import { deviceIsConnected, publishDevice } from "./realtime/bus";
import { currentClientVersion, sanitizeClientVersion } from "./client-version";

export type AgentUpdateMessage = { type: "agent-update"; version: string; path: string };

/** WS push payload the agent understands (see agent/RealtimeChannel.cs). */
export function agentUpdateMessage(): AgentUpdateMessage {
  return {
    type: "agent-update",
    version: currentClientVersion(),
    path: "/api/agent/update/download",
  };
}

export type UpdateRequestResult =
  | { ok: true; version: string }
  | { ok: false; status: number; error: string };

/**
 * Push an agent update to one device. Idempotent: pushing the same or an older
 * build is rejected so a stuck device can be nudged without reinstall loops.
 */
export function requestAgentUpdate(
  db: DatabaseSync,
  deviceId: string,
  actor: string,
): UpdateRequestResult {
  const device = getDevice(db, deviceId);
  if (!device) return { ok: false, status: 404, error: "unknown device" };
  if (!deviceIsConnected(deviceId)) {
    return { ok: false, status: 409, error: "device offline" };
  }
  const target = agentUpdateMessage();
  const installed = sanitizeClientVersion(device.agentVersion);
  if (installed === target.version) {
    return { ok: false, status: 409, error: `already on ${target.version}` };
  }

  const sent = publishDevice(deviceId, target);
  if (sent < 1) {
    return { ok: false, status: 409, error: "device unreachable" };
  }

  // Optimistic marker; the authoritative value arrives via version-report.
  setDeviceAgentVersion(db, deviceId, `${target.version}+pending`);
  appendAudit(db, actor, "device.update.pushed", deviceId, {
    from: device.agentVersion || "(unknown)",
    to: target.version,
  });
  return { ok: true, version: target.version };
}
