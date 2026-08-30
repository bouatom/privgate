import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { appendAudit, getDevice, listDeviceSummaries } from "./db";
import { setDeviceAgentVersion, setDeviceUpdateRequestedAt } from "./db/devices";
import { connectedDeviceIds, deviceIsConnected, publishDevice } from "./realtime/bus";
import {
  compareVersions,
  currentClientVersion,
  sanitizeClientVersion,
  updateAvailable,
} from "./client-version";

export type AgentUpdateMessage = { type: "agent-update"; version: string; path: string };

/** WS push payload the agent understands (see agent/RealtimeChannel.cs). */
export function agentUpdateMessage(): AgentUpdateMessage {
  return {
    type: "agent-update",
    version: currentClientVersion(),
    path: "/api/agent/update/download",
  };
}

/** What the device should show on a user-initiated "check for updates". */
export function describeClientUpdate(installedRaw: string): {
  installed: string;
  latest: string;
  available: boolean;
} {
  const latest = currentClientVersion();
  const installed = sanitizeClientVersion(installedRaw);
  return {
    installed,
    latest,
    available: updateAvailable(installedRaw, latest),
  };
}

export type UpdateRequestResult =
  | { ok: true; version: string; queued?: boolean }
  | { ok: false; status: number; error: string };

/** Pending markers carry the push time so stuck pushes can be detected. */
const PENDING_STALE_MS = 30 * 60_000;
export { PENDING_STALE_MS };

/**
 * Marker stored in devices.agent_version while a push is outstanding:
 * `<version>+pending@<epochMs>`. sanitizeClientVersion splits on [-+], so
 * every marker still compares as its plain version.
 */
export function pendingMarker(version: string, pushedAt = Date.now()): string {
  return `${version}+pending@${pushedAt}`;
}

/** Parse `<version>+pending[@<epochMs>]`; null when the value is not pending. */
export function parsePendingMarker(raw: string): { version: string; pushedAt: number | null } | null {
  const match = /^(.+?)\+pending(?:@(\d+))?$/.exec(raw.trim());
  if (!match) return null;
  return { version: match[1], pushedAt: match[2] ? Number(match[2]) : null };
}

/**
 * Push an agent update to one device. Idempotent: pushing the same or an older
 * build is rejected so a stuck device can be nudged without reinstall loops.
 * Offline devices are queued instead of failing; the queue is served when the
 * device next reports in or reconnects.
 */
export function requestAgentUpdate(
  db: DatabaseSync,
  deviceId: string,
  actor: string,
): UpdateRequestResult {
  const device = getDevice(db, deviceId);
  if (!device) return { ok: false, status: 404, error: "unknown device" };
  const target = agentUpdateMessage();
  const installed = sanitizeClientVersion(device.agentVersion);
  if (device.agentVersion.trim() && installed === target.version) {
    return { ok: false, status: 409, error: `already on ${target.version}` };
  }

  if (!deviceIsConnected(deviceId)) {
    // Queue for delivery when the device checks back in.
    setDeviceUpdateRequestedAt(db, deviceId, new Date().toISOString());
    appendAudit(db, actor, "device.update.queued", deviceId, { target: target.version });
    return { ok: true, queued: true, version: target.version };
  }

  const sent = publishDevice(deviceId, target);
  if (sent < 1) {
    return { ok: false, status: 409, error: "device unreachable" };
  }

  // Optimistic marker; the authoritative value arrives via version-report.
  setDeviceAgentVersion(db, deviceId, pendingMarker(target.version));
  appendAudit(db, actor, "device.update.pushed", deviceId, {
    from: device.agentVersion || "(unknown)",
    to: target.version,
  });
  return { ok: true, version: target.version };
}

export type ReconcileResult = { completed: boolean; servedQueued: boolean };

/**
 * Called from the version-report RPC path with what the device says it runs.
 * Stores the authoritative version, resolves a pending push marker
 * (completed / stale), then serves any queued update that is still needed.
 */
export function reconcileReportedVersion(
  db: DatabaseSync,
  deviceId: string,
  reportedRaw: string,
): ReconcileResult {
  const reported = sanitizeClientVersion(reportedRaw);
  const device = getDevice(db, deviceId);
  if (!device) return { completed: false, servedQueued: false };

  const marker = parsePendingMarker(device.agentVersion);
  setDeviceAgentVersion(db, deviceId, reported);

  let completed = false;
  if (marker && compareVersions(reported, marker.version) >= 0) {
    appendAudit(db, `device:${deviceId}`, "device.update.completed", deviceId, {
      from: marker.version,
      to: reported,
    });
    completed = true;
  } else if (marker?.pushedAt && Date.now() - marker.pushedAt > PENDING_STALE_MS) {
    // Still behind half an hour after the push → flag as failed for the UI.
    setDeviceAgentVersion(db, deviceId, `${marker.version}+stale@${marker.pushedAt}`);
    appendAudit(db, `device:${deviceId}`, "device.update.stale", deviceId, {
      expected: marker.version,
      reported,
      waitedMs: Date.now() - marker.pushedAt,
    });
  } else if (marker && compareVersions(reported, marker.version) < 0) {
    // Device reported an older version while a push is outstanding — the
    // update likely failed (download error, MSI rollback, etc.). Record the
    // failure and keep the marker so the UI shows the attempt.
    appendAudit(db, `device:${deviceId}`, "device.update.failed", deviceId, {
      expected: marker.version,
      reported,
    });
    // Keep the pending marker visible so the UI keeps showing the attempt.
    setDeviceAgentVersion(
      db,
      deviceId,
      marker.pushedAt ? `${marker.version}+pending@${marker.pushedAt}` : `${marker.version}+pending`,
    );
  }

  const servedQueued = servePendingUpdateRequest(db, deviceId, reported);
  return { completed, servedQueued };
}

/**
 * Reconnect path: if an update was queued while the device was offline, push
 * it now that a socket is live — unless the device already runs the target.
 */
export function drainQueuedUpdateOnReconnect(db: DatabaseSync, deviceId: string): boolean {
  return servePendingUpdateRequest(db, deviceId);
}

function servePendingUpdateRequest(
  db: DatabaseSync,
  deviceId: string,
  reportedVersion?: string,
): boolean {
  const device = getDevice(db, deviceId);
  if (!device?.updateRequestedAt) return false;
  const known = sanitizeClientVersion(reportedVersion ?? device.agentVersion);
  const target = agentUpdateMessage().version;

  if (!known.trim() || compareVersions(known, target) < 0) {
    const sent = publishDevice(deviceId, agentUpdateMessage());
    if (sent < 1) return false; // stay queued until a socket is really live
    setDeviceAgentVersion(db, deviceId, pendingMarker(target));
    setDeviceUpdateRequestedAt(db, deviceId, "");
    appendAudit(db, "system:update-queue", "device.update.pushed", deviceId, {
      from: device.agentVersion || "(unknown)",
      to: target,
      queuedRequest: device.updateRequestedAt,
    });
    return true;
  }

  setDeviceUpdateRequestedAt(db, deviceId, "");
  return false;
}

export type BulkSkip = { deviceId: string; reason: string };

export type BulkUpdateSummary = {
  pushed: number;
  queued: Array<{ deviceId: string; version: string }>;
  skipped: BulkSkip[];
};

/** Every online device whose sanitized version is older than what we serve. */
export function selectStaleOnlineDevices(db: DatabaseSync): string[] {
  const online = new Set(connectedDeviceIds());
  const target = currentClientVersion();
  return listDeviceSummaries(db)
    .filter((d) => online.has(d.id) && updateAvailable(d.agentVersion, target))
    .map((d) => d.id);
}

/** Push to many devices, collecting per-device outcomes instead of failing fast. */
export function bulkRequestAgentUpdates(
  db: DatabaseSync,
  ids: string[],
  actor: string,
): BulkUpdateSummary {
  const summary: BulkUpdateSummary = { pushed: 0, queued: [], skipped: [] };
  for (const deviceId of ids.slice(0, 500)) {
    const result = requestAgentUpdate(db, deviceId, actor);
    if (result.ok) {
      if (result.queued) summary.queued.push({ deviceId, version: result.version });
      else summary.pushed += 1;
    } else {
      summary.skipped.push({ deviceId, reason: `${result.error} (${result.status})` });
    }
  }
  return summary;
}
