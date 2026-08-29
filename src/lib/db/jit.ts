import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getUser } from "./users";
import type { JitGrant } from "./types";

export type JitListRow = JitGrant & {
  /** Display label: display name for personal grants, group name otherwise. */
  userName: string;
  hostname: string;
  kind: "user" | "group";
  groupName: string;
  /** Snapshot size at grant time (0 for personal grants). */
  memberCount: number;
};

export function listJit(db: DatabaseSync): JitListRow[] {
  const rows = db
    .prepare(
      `SELECT j.*, u.display_name AS user_name, d.hostname, g.name AS group_name
       FROM jit_grants j
       LEFT JOIN users u ON u.id = j.user_id AND j.user_id != ''
       LEFT JOIN groups g ON g.id = j.group_id AND j.group_id != ''
       JOIN devices d ON d.id = j.device_id
       ORDER BY j.starts_at DESC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((row) => {
    const grant = jitFromRow(row);
    const groupName = String(row.group_name || "");
    return {
      ...grant,
      // Group grants are labeled by their group so every consumer shows who was
      // actually granted access; memberCount is the grant-time snapshot size.
      userName: grant.kind === "group" ? groupName : String(row.user_name ?? ""),
      hostname: String(row.hostname),
      kind: grant.kind,
      groupName,
      memberCount: grant.memberIds.length,
    };
  });
}

export function jitFromRow(row: Record<string, unknown>): JitGrant {
  const groupId = String(row.group_id ?? "");
  let memberIds: string[] = [];
  try {
    const parsed = JSON.parse(String(row.member_ids_json || "[]")) as unknown;
    if (Array.isArray(parsed)) memberIds = parsed.map(String);
  } catch {
    memberIds = [];
  }
  return {
    id: String(row.id),
    userId: String(row.user_id),
    groupId,
    deviceId: String(row.device_id),
    durationMinutes: Number(row.duration_minutes),
    reason: String(row.reason),
    startsAt: String(row.starts_at),
    expiresAt: String(row.expires_at),
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    revokedBy: row.revoked_by ? String(row.revoked_by) : null,
    status: String(row.status),
    memberIds,
    kind: groupId ? "group" : "user",
  };
}

function parseMemberIds(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw || "[]")) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * The grant covering a user on a device, if any. A user is covered by a
 * personal grant targeting them OR by any active group grant whose grant-time
 * membership snapshot includes them (union of access; the latest-expiring
 * covering grant wins). Membership is resolved from the snapshot
 * (member_ids_json), never from live directory rows, so revoke/expiry stay
 * deterministic even if the directory churns mid-window.
 */
export function activeJit(db: DatabaseSync, userId: string, deviceId: string, now = new Date()): JitGrant | undefined {
  const rows = db
    .prepare(
      `SELECT * FROM jit_grants
       WHERE device_id = ? AND status = 'active' AND (user_id = ? OR group_id != '')
       ORDER BY expires_at DESC`,
    )
    .all(deviceId, userId) as Record<string, unknown>[];
  for (const row of rows) {
    const isPersonal = String(row.user_id) === userId;
    if (!isPersonal && !parseMemberIds(row.member_ids_json).includes(userId)) continue;
    const grant = jitFromRow(row);
    if (new Date(grant.expiresAt).getTime() <= now.getTime()) {
      db.prepare("UPDATE jit_grants SET status = 'expired' WHERE id = ?").run(grant.id);
      continue;
    }
    return grant;
  }
  return undefined;
}

export function createJit(
  db: DatabaseSync,
  input: { userId?: string; groupId?: string; deviceId: string; durationMinutes: number; reason: string },
): JitGrant | { error: string } {
  if (!Number.isFinite(input.durationMinutes) || input.durationMinutes < 15 || input.durationMinutes > 60) {
    return { error: "duration must be 15–60 minutes" };
  }
  if (!input.reason.trim()) return { error: "reason required" };
  const hasUser = Boolean(input.userId?.trim());
  const hasGroup = Boolean(input.groupId?.trim());
  if (hasUser === hasGroup) return { error: "provide exactly one of userId or groupId" };

  let memberIds: string[] = [];
  let groupId = "";
  let userId = "";
  if (hasGroup) {
    groupId = input.groupId!.trim();
    const group = db.prepare("SELECT id FROM groups WHERE id = ?").get(groupId) as { id: string } | undefined;
    if (!group) return { error: "group not found" };
    const members = db.prepare("SELECT user_id FROM group_members WHERE group_id = ?").all(groupId) as {
      user_id: string;
    }[];
    memberIds = members.map((m) => m.user_id);
    if (memberIds.length === 0) return { error: "group has no members to snapshot" };
    if (activeGroupJit(db, groupId, input.deviceId)) {
      return { error: "an active JIT window already exists for this group and device" };
    }
  } else {
    userId = input.userId!.trim();
    const user = getUser(db, userId);
    if (!user) return { error: "user not found" };
    if (activeJit(db, userId, input.deviceId)) {
      return { error: "an active JIT window already exists for this user and device" };
    }
  }

  const id = randomUUID();
  const starts = new Date();
  const expires = new Date(starts.getTime() + input.durationMinutes * 60_000);
  db.prepare(
    `INSERT INTO jit_grants (id, user_id, device_id, duration_minutes, reason, starts_at, expires_at, status, group_id, member_ids_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
  ).run(
    id,
    userId,
    input.deviceId,
    input.durationMinutes,
    input.reason.trim(),
    starts.toISOString(),
    expires.toISOString(),
    groupId,
    JSON.stringify(memberIds),
  );
  const row = db.prepare("SELECT * FROM jit_grants WHERE id = ?").get(id) as Record<string, unknown>;
  return jitFromRow(row);
}

export function activeGroupJit(db: DatabaseSync, groupId: string, deviceId: string): JitGrant | undefined {
  const row = db
    .prepare(
      `SELECT * FROM jit_grants WHERE group_id = ? AND device_id = ? AND status = 'active'
       ORDER BY expires_at DESC LIMIT 1`,
    )
    .get(groupId, deviceId) as Record<string, unknown> | undefined;
  return row ? jitFromRow(row) : undefined;
}

export function getJit(db: DatabaseSync, id: string): JitGrant | undefined {
  const row = db.prepare("SELECT * FROM jit_grants WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? jitFromRow(row) : undefined;
}

/// Flips every due active grant to 'expired' and returns what changed so callers
/// can notify devices and audit. Pure db layer: no realtime imports here.
export function expireDueGrants(db: DatabaseSync, now = new Date()): JitGrant[] {
  const due = db
    .prepare(`SELECT * FROM jit_grants WHERE status = 'active' AND expires_at <= ?`)
    .all(now.toISOString()) as Record<string, unknown>[];
  if (due.length === 0) return [];
  const ids = due.map((row) => String(row.id));
  db.prepare(`UPDATE jit_grants SET status = 'expired' WHERE id IN (${ids.map(() => "?").join(", ")})`).run(...ids);
  return due.map(jitFromRow);
}

export function revokeJit(db: DatabaseSync, id: string, actor: string): JitGrant | undefined {
  const row = db.prepare("SELECT * FROM jit_grants WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const grant = jitFromRow(row);
  if (grant.status !== "active") return grant;
  db.prepare("UPDATE jit_grants SET status = 'revoked', revoked_at = ?, revoked_by = ? WHERE id = ?").run(
    new Date().toISOString(),
    actor,
    id,
  );
  return jitFromRow(db.prepare("SELECT * FROM jit_grants WHERE id = ?").get(id) as Record<string, unknown>);
}

/**
 * Identities covered by a grant: the grant's user, or every snapshotted group
 * member that still resolves to a directory row. Used to address per-SID
 * jit-grant/jit-revoke pushes and audit entries.
 */
export function grantIdentities(
  db: DatabaseSync,
  grant: JitGrant,
): Array<{ userId: string; displayName: string; adSid: string; userSid: string }> {
  const ids = grant.groupId ? grant.memberIds : [grant.userId].filter((id) => id !== "");
  const identities: Array<{ userId: string; displayName: string; adSid: string; userSid: string }> = [];
  for (const userId of ids) {
    const user = getUser(db, userId);
    if (!user) continue;
    identities.push({
      userId: user.id,
      displayName: user.displayName,
      // Raw AD SID — the only identifier local Administrators membership uses.
      adSid: user.adSid,
      // Ticket subject fallback chain used elsewhere in the console.
      userSid: user.adSid || user.entraOid || user.id,
    });
  }
  return identities;
}
