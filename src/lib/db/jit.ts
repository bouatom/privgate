import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getUser } from "./users";
import type { JitGrant } from "./types";

export function listJit(db: DatabaseSync): Array<JitGrant & { userName: string; hostname: string }> {
  const rows = db
    .prepare(
      `SELECT j.*, u.display_name AS user_name, d.hostname
       FROM jit_grants j
       JOIN users u ON u.id = j.user_id
       JOIN devices d ON d.id = j.device_id
       ORDER BY j.starts_at DESC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((row) => ({
    ...jitFromRow(row),
    userName: String(row.user_name),
    hostname: String(row.hostname),
  }));
}

export function jitFromRow(row: Record<string, unknown>): JitGrant {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    deviceId: String(row.device_id),
    durationMinutes: Number(row.duration_minutes),
    reason: String(row.reason),
    startsAt: String(row.starts_at),
    expiresAt: String(row.expires_at),
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    revokedBy: row.revoked_by ? String(row.revoked_by) : null,
    status: String(row.status),
  };
}

export function activeJit(db: DatabaseSync, userId: string, deviceId: string, now = new Date()): JitGrant | undefined {
  const row = db
    .prepare(
      `SELECT * FROM jit_grants
       WHERE user_id = ? AND device_id = ? AND status = 'active'
       ORDER BY expires_at DESC LIMIT 1`,
    )
    .get(userId, deviceId) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const grant = jitFromRow(row);
  if (new Date(grant.expiresAt).getTime() <= now.getTime()) {
    db.prepare("UPDATE jit_grants SET status = 'expired' WHERE id = ?").run(grant.id);
    return undefined;
  }
  return grant;
}

export function createJit(
  db: DatabaseSync,
  input: { userId: string; deviceId: string; durationMinutes: number; reason: string },
): JitGrant | { error: string } {
  if (input.durationMinutes < 15 || input.durationMinutes > 60) {
    return { error: "duration must be 15–60 minutes" };
  }
  if (!input.reason.trim()) return { error: "reason required" };
  const user = getUser(db, input.userId);
  if (!user) return { error: "user not found" };
  if (!user.jitEligible) return { error: "user is not JIT eligible" };
  if (user.disabled) return { error: "user disabled" };
  if (activeJit(db, input.userId, input.deviceId)) {
    return { error: "an active JIT window already exists for this user and device" };
  }
  const id = randomUUID();
  const starts = new Date();
  const expires = new Date(starts.getTime() + input.durationMinutes * 60_000);
  db.prepare(
    `INSERT INTO jit_grants (id, user_id, device_id, duration_minutes, reason, starts_at, expires_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
  ).run(
    id,
    input.userId,
    input.deviceId,
    input.durationMinutes,
    input.reason.trim(),
    starts.toISOString(),
    expires.toISOString(),
  );
  const row = db.prepare("SELECT * FROM jit_grants WHERE id = ?").get(id) as Record<string, unknown>;
  return jitFromRow(row);
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
