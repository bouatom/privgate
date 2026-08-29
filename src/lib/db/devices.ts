import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { decryptSecret, encryptSecret } from "../crypto-secret";
import { listAuditForDevice } from "./audit";
import { listJit } from "./jit";
import { listRequests } from "./requests";
import { listUacPromptsForDevice } from "./uac-prompts";
import type { Device, DeviceSummary } from "./types";

export function listDevices(db: DatabaseSync): Array<Omit<Device, "secretEnc"> & { hostname: string }> {
  const rows = db
    .prepare(
      "SELECT id, hostname, join_type, enrolled_at, agent_version, last_seen_at, last_ip, update_requested_at, update_mode, update_schedule FROM devices ORDER BY hostname",
    )
    .all() as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id),
    hostname: String(row.hostname),
    joinType: String(row.join_type),
    enrolledAt: String(row.enrolled_at),
    agentVersion: String(row.agent_version ?? ""),
    lastSeenAt: String(row.last_seen_at ?? ""),
    lastIp: String(row.last_ip ?? ""),
    updateRequestedAt: String(row.update_requested_at ?? ""),
    updateMode: String(row.update_mode ?? ""),
    updateSchedule: String(row.update_schedule ?? ""),
    secretEnc: "",
  }));
}

export function listDeviceSummaries(db: DatabaseSync): DeviceSummary[] {
  const rows = db
    .prepare(
      `SELECT d.id, d.hostname, d.join_type, d.enrolled_at, d.agent_version, d.last_seen_at, d.last_ip, d.update_requested_at, d.update_mode, d.update_schedule,
        (SELECT COUNT(*) FROM requests r WHERE r.device_id = d.id AND r.status = 'pending') AS pending_requests,
        (SELECT COUNT(*) FROM jit_grants j WHERE j.device_id = d.id AND j.status = 'active') AS active_jit,
        (SELECT a.at FROM audit_events a
          WHERE a.actor = 'device:' || d.id OR a.target = d.id
            OR a.target IN (SELECT r.id FROM requests r WHERE r.device_id = d.id)
          ORDER BY a.at DESC, a.rowid DESC LIMIT 1) AS last_event_at,
        (SELECT a.action FROM audit_events a
          WHERE a.actor = 'device:' || d.id OR a.target = d.id
            OR a.target IN (SELECT r.id FROM requests r WHERE r.device_id = d.id)
          ORDER BY a.at DESC, a.rowid DESC LIMIT 1) AS last_action
       FROM devices d
       ORDER BY d.hostname`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id),
    hostname: String(row.hostname),
    joinType: String(row.join_type),
    enrolledAt: String(row.enrolled_at),
    pendingRequests: Number(row.pending_requests),
    activeJit: Number(row.active_jit),
    lastEventAt: row.last_event_at ? String(row.last_event_at) : null,
    lastAction: row.last_action ? String(row.last_action) : null,
    agentVersion: String(row.agent_version ?? ""),
    lastSeenAt: row.last_seen_at ? String(row.last_seen_at) : null,
    lastIp: String(row.last_ip ?? ""),
    updateRequestedAt: row.update_requested_at ? String(row.update_requested_at) : null,
    updateMode: String(row.update_mode ?? ""),
    updateSchedule: String(row.update_schedule ?? ""),
    // Runtime values, filled by callers with realtime-hub access (devices
    // page). Null here so DB-only consumers never render a misleading pill.
    uiAlive: null,
    uiLastSeenAt: null,
  }));
}

export function deviceDetail(db: DatabaseSync, deviceId: string) {
  const device = getDevice(db, deviceId);
  if (!device) return undefined;
  return {
    id: device.id,
    hostname: device.hostname,
    joinType: device.joinType,
    enrolledAt: device.enrolledAt,
    agentVersion: device.agentVersion,
    lastSeenAt: device.lastSeenAt,
    lastIp: device.lastIp,
    updateRequestedAt: device.updateRequestedAt,
    events: listAuditForDevice(db, deviceId).map((e) => ({
      ...e,
      details: JSON.parse(e.details || "{}") as Record<string, unknown>,
    })),
    requests: listRequests(db).filter((r) => r.deviceId === deviceId),
    uacPrompts: listUacPromptsForDevice(db, deviceId),
    jit: listJit(db).filter((g) => g.deviceId === deviceId),
  };
}

export function getDevice(db: DatabaseSync, id: string): Device | undefined {
  const row = db.prepare("SELECT * FROM devices WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return deviceFromRow(row);
}

export function getDeviceByHostname(db: DatabaseSync, hostname: string): Device | undefined {
  const row = db
    .prepare("SELECT * FROM devices WHERE lower(hostname) = lower(?)")
    .get(hostname) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return deviceFromRow(row);
}

function deviceFromRow(row: Record<string, unknown>): Device {
  return {
    id: String(row.id),
    hostname: String(row.hostname),
    joinType: String(row.join_type),
    secretEnc: String(row.secret_enc),
    enrolledAt: String(row.enrolled_at),
    agentVersion: String(row.agent_version ?? ""),
    lastSeenAt: String(row.last_seen_at ?? ""),
    lastIp: String(row.last_ip ?? ""),
    updateRequestedAt: String(row.update_requested_at ?? ""),
    updateMode: String(row.update_mode ?? ""),
    updateSchedule: String(row.update_schedule ?? ""),
  };
}

export function enrollDevice(
  db: DatabaseSync,
  hostname: string,
  joinType: string,
  secretKey: string,
): { id: string; secret: string; hostname: string } {
  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  db.prepare(`INSERT INTO devices (id, hostname, join_type, secret_enc, enrolled_at) VALUES (?, ?, ?, ?, ?)`).run(
    id,
    hostname,
    joinType || "unknown",
    encryptSecret(secret, secretKey),
    new Date().toISOString(),
  );
  return { id, secret, hostname };
}

export function registerOrReuseDevice(
  db: DatabaseSync,
  hostname: string,
  joinType: string,
  secretKey: string,
): { id: string; secret: string; hostname: string; reused: boolean } {
  const existing = getDeviceByHostname(db, hostname);
  if (existing) {
    if (joinType && joinType !== "unknown") {
      db.prepare("UPDATE devices SET join_type = ? WHERE id = ?").run(joinType, existing.id);
    }
    return {
      id: existing.id,
      secret: decryptSecret(existing.secretEnc, secretKey),
      hostname: existing.hostname,
      reused: true,
    };
  }
  const created = enrollDevice(db, hostname, joinType || "unknown", secretKey);
  return { ...created, reused: false };
}

export function consumeNonce(db: DatabaseSync, nonce: string): boolean {
  try {
    db.prepare("INSERT INTO consumed_nonces (nonce, consumed_at) VALUES (?, ?)").run(nonce, new Date().toISOString());
    return true;
  } catch {
    return false;
  }
}

export function setDeviceAgentVersion(db: DatabaseSync, deviceId: string, version: string) {
  db.prepare("UPDATE devices SET agent_version = ? WHERE id = ?").run(version, deviceId);
}

/** Stamp the socket presence window: called on agent connect and socket close. */
export function touchDeviceLastSeen(db: DatabaseSync, deviceId: string) {
  db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(new Date().toISOString(), deviceId);
}

/** Stamp the device's last connecting source IP. Ignored when ip is blank. */
export function setDeviceLastIp(db: DatabaseSync, deviceId: string, ip: string) {
  if (!ip) return;
  db.prepare("UPDATE devices SET last_ip = ? WHERE id = ?").run(ip, deviceId);
}

/** Queue (ISO timestamp) or un-queue ('') an update for an offline device. */
export function setDeviceUpdateRequestedAt(db: DatabaseSync, deviceId: string, value: string) {
  db.prepare("UPDATE devices SET update_requested_at = ? WHERE id = ?").run(value, deviceId);
}
