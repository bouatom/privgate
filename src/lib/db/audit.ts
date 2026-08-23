import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AuditEvent } from "./types";

export function appendAudit(
  db: DatabaseSync,
  actor: string,
  action: string,
  target: string,
  details: Record<string, unknown> = {},
) {
  db.prepare(
    `INSERT INTO audit_events (id, at, actor, action, target, details) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), new Date().toISOString(), actor, action, target, JSON.stringify(details));
}

export function listAudit(db: DatabaseSync, q?: string): AuditEvent[] {
  const rows = (
    q
      ? db
          .prepare(
            `SELECT * FROM audit_events
             WHERE action LIKE ? OR actor LIKE ? OR target LIKE ? OR details LIKE ?
             ORDER BY at DESC LIMIT 200`,
          )
          .all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`)
      : db.prepare("SELECT * FROM audit_events ORDER BY at DESC LIMIT 200").all()
  ) as Record<string, unknown>[];
  return rows.map(auditFromRow);
}

export function listAuditForDevice(db: DatabaseSync, deviceId: string): AuditEvent[] {
  const actor = `device:${deviceId}`;
  const rows = db
    .prepare(
      `SELECT * FROM audit_events
       WHERE actor = ? OR target = ? OR details LIKE ?
         OR target IN (SELECT id FROM requests WHERE device_id = ?)
       ORDER BY at DESC LIMIT 200`,
    )
    .all(actor, deviceId, `%${deviceId}%`, deviceId) as Record<string, unknown>[];
  return rows.map(auditFromRow);
}

function auditFromRow(row: Record<string, unknown>): AuditEvent {
  return {
    id: String(row.id),
    at: String(row.at),
    actor: String(row.actor),
    action: String(row.action),
    target: String(row.target),
    details: String(row.details),
  };
}
