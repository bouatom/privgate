import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DeviceGroup } from "./types";

function groupFromRow(row: Record<string, unknown>): Omit<DeviceGroup, "deviceIds"> {
  return {
    id: String(row.id),
    name: String(row.name),
    priority: Number(row.priority ?? 0),
    updateMode: String(row.update_mode ?? ""),
    updateSchedule: String(row.update_schedule ?? ""),
  };
}

/** All device groups with their member device ids. */
export function listDeviceGroups(db: DatabaseSync): DeviceGroup[] {
  const groups = db
    .prepare("SELECT * FROM device_groups ORDER BY name COLLATE NOCASE")
    .all() as Record<string, unknown>[];
  const members = db
    .prepare("SELECT group_id, device_id FROM device_group_members")
    .all() as { group_id: string; device_id: string }[];
  const byGroup = new Map<string, string[]>();
  for (const m of members) {
    const arr = byGroup.get(m.group_id) ?? [];
    arr.push(m.device_id);
    byGroup.set(m.group_id, arr);
  }
  return groups.map((g) => ({ ...groupFromRow(g), deviceIds: byGroup.get(String(g.id)) ?? [] }));
}

export function getDeviceGroup(db: DatabaseSync, id: string): DeviceGroup | undefined {
  const row = db.prepare("SELECT * FROM device_groups WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const deviceIds = (
    db.prepare("SELECT device_id FROM device_group_members WHERE group_id = ?").all(id) as { device_id: string }[]
  ).map((r) => r.device_id);
  return { ...groupFromRow(row), deviceIds };
}

export function getDeviceGroupByName(db: DatabaseSync, name: string): Omit<DeviceGroup, "deviceIds"> | undefined {
  const row = db
    .prepare("SELECT * FROM device_groups WHERE lower(name) = lower(?)")
    .get(name) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return groupFromRow(row);
}

export function createDeviceGroup(db: DatabaseSync, name: string, priority = 0): DeviceGroup {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO device_groups (id, name, priority, created_at) VALUES (?, ?, ?, ?)",
  ).run(id, name, priority, new Date().toISOString());
  return getDeviceGroup(db, id)!;
}

export function renameDeviceGroup(
  db: DatabaseSync,
  id: string,
  patch: { name?: string; priority?: number },
): { ok: boolean; error?: string } {
  const existing = getDeviceGroup(db, id);
  if (!existing) return { ok: false, error: "unknown group" };
  if (patch.name !== undefined) {
    const clash = getDeviceGroupByName(db, patch.name);
    if (clash && clash.id !== id) return { ok: false, error: "a group with that name already exists" };
    db.prepare("UPDATE device_groups SET name = ? WHERE id = ?").run(patch.name.trim(), id);
  }
  if (patch.priority !== undefined) {
    db.prepare("UPDATE device_groups SET priority = ? WHERE id = ?").run(Number(patch.priority) || 0, id);
  }
  return { ok: true };
}

export function deleteDeviceGroup(db: DatabaseSync, id: string): { ok: boolean; error?: string } {
  const existing = getDeviceGroup(db, id);
  if (!existing) return { ok: false, error: "unknown group" };
  db.prepare("DELETE FROM device_group_members WHERE group_id = ?").run(id);
  db.prepare("DELETE FROM device_groups WHERE id = ?").run(id);
  return { ok: true };
}

export function setDeviceGroupPolicy(
  db: DatabaseSync,
  id: string,
  policy: { mode: string; schedule?: string },
): { ok: boolean; error?: string } {
  if (!getDeviceGroup(db, id)) return { ok: false, error: "unknown group" };
  db.prepare("UPDATE device_groups SET update_mode = ?, update_schedule = ? WHERE id = ?").run(
    policy.mode,
    policy.schedule ?? "",
    id,
  );
  return { ok: true };
}

/** Add device ids to a group, ignoring ids that are already members or unknown. */
export function addGroupMembers(db: DatabaseSync, groupId: string, deviceIds: string[]): number {
  const known = new Set(
    (db.prepare("SELECT id FROM devices").all() as { id: string }[]).map((r) => r.id),
  );
  let added = 0;
  const insert = db.prepare(
    "INSERT OR IGNORE INTO device_group_members (group_id, device_id) VALUES (?, ?)",
  );
  for (const deviceId of deviceIds) {
    if (known.has(deviceId) && insert.run(groupId, deviceId).changes > 0) added++;
  }
  return added;
}

/** Remove device ids from a group. Returns how many were actually removed. */
export function removeGroupMembers(db: DatabaseSync, groupId: string, deviceIds: string[]): number {
  const remove = db.prepare("DELETE FROM device_group_members WHERE group_id = ? AND device_id = ?");
  let removed = 0;
  for (const deviceId of deviceIds) {
    if (remove.run(groupId, deviceId).changes > 0) removed++;
  }
  return removed;
}

/**
 * Groups that set a device update policy for the given device, ordered by
 * priority descending (highest first) then name. Only groups with a non-empty
 * update_mode count — a group whose policy is unset means "inherit".
 */
export function groupsWithPolicyForDevice(db: DatabaseSync, deviceId: string): Omit<DeviceGroup, "deviceIds">[] {
  return (
    db
      .prepare(
        `SELECT g.* FROM device_groups g
         JOIN device_group_members m ON m.group_id = g.id
         WHERE m.device_id = ? AND g.update_mode <> ''
         ORDER BY g.priority DESC, g.name COLLATE NOCASE`,
      )
      .all(deviceId) as Record<string, unknown>[]
  ).map(groupFromRow);
}

/** All groups a device belongs to, ordered by priority desc then name. */
export function groupsForDevice(db: DatabaseSync, deviceId: string): Omit<DeviceGroup, "deviceIds">[] {
  return (
    db
      .prepare(
        `SELECT g.* FROM device_groups g
         JOIN device_group_members m ON m.group_id = g.id
         WHERE m.device_id = ?
         ORDER BY g.priority DESC, g.name COLLATE NOCASE`,
      )
      .all(deviceId) as Record<string, unknown>[]
  ).map(groupFromRow);
}

/** Set a direct per-device update policy ('' mode clears/inherits). */
export function setDeviceUpdatePolicy(
  db: DatabaseSync,
  deviceId: string,
  policy: { mode: string; schedule?: string },
): { ok: boolean; error?: string } {
  const device = db.prepare("SELECT id FROM devices WHERE id = ?").get(deviceId) as { id: string } | undefined;
  if (!device) return { ok: false, error: "unknown device" };
  db.prepare("UPDATE devices SET update_mode = ?, update_schedule = ? WHERE id = ?").run(
    policy.mode,
    policy.schedule ?? "",
    deviceId,
  );
  return { ok: true };
}
