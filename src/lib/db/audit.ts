import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AuditEvent } from "./types";

/** Default number of days of audit history to keep when a retention is configured. */
export const DEFAULT_AUDIT_RETENTION_DAYS = 365;

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

export type AuditListOptions = {
  /** Free-text search over action, actor, target, and details. */
  q?: string;
  /** Exact action match, e.g. "request.approve". */
  action?: string;
  /** Inclusive lower bound on `at` (ISO string). */
  from?: string;
  /** Inclusive upper bound on `at` (ISO string). */
  to?: string;
  limit?: number;
  offset?: number;
};

const AUDIT_DEFAULT_LIMIT = 200;
const AUDIT_MAX_LIMIT = 1000;

/** Builds the WHERE clause shared by listAudit and listAuditCount so counts and rows always agree. */
function auditWhere(opts: AuditListOptions): { where: string; params: Array<string | number> } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (opts.q) {
    clauses.push("(action LIKE ? OR actor LIKE ? OR target LIKE ? OR details LIKE ?)");
    const like = `%${opts.q}%`;
    params.push(like, like, like, like);
  }
  if (opts.action) {
    clauses.push("action = ?");
    params.push(opts.action);
  }
  if (opts.from) {
    clauses.push("at >= ?");
    params.push(opts.from);
  }
  if (opts.to) {
    clauses.push("at <= ?");
    params.push(opts.to);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

/**
 * List audit events newest-first. Accepts either a legacy bare search string
 * (`listAudit(db, "text")` — kept for existing callers) or an options object
 * with SQL-bounded filters for date range, exact action, and pagination.
 */
export function listAudit(db: DatabaseSync, options: string | AuditListOptions = {}): AuditEvent[] {
  const opts = typeof options === "string" ? { q: options } : options;
  const { where, params } = auditWhere(opts);
  const limit = Math.max(0, Math.min(opts.limit ?? AUDIT_DEFAULT_LIMIT, AUDIT_MAX_LIMIT));
  const offset = Math.max(0, opts.offset ?? 0);
  const rows = db
    .prepare(`SELECT * FROM audit_events ${where} ORDER BY at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Record<string, unknown>[];
  return rows.map(auditFromRow);
}

/** Total events matching the same filters as listAudit (q/action/from/to); limit/offset ignored. */
export function listAuditCount(db: DatabaseSync, options: Omit<AuditListOptions, "limit" | "offset"> = {}): number {
  const { where, params } = auditWhere(options);
  const row = db.prepare(`SELECT COUNT(*) AS total FROM audit_events ${where}`).get(...params) as
    | { total?: unknown }
    | undefined;
  return Number(row?.total ?? 0);
}

/** Distinct actions present in the audit log, for filter dropdowns. */
export function listAuditActions(db: DatabaseSync): string[] {
  const rows = db.prepare("SELECT DISTINCT action FROM audit_events ORDER BY action").all() as Record<
    string,
    unknown
  >[];
  return rows.map((row) => String(row.action));
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

/**
 * Resolve the effective audit retention in days from raw input (an env string
 * or already-parsed number). Falls back to `DEFAULT_AUDIT_RETENTION_DAYS` when
 * the input is not a positive number. Returns 0 only for an explicitly negative
 * "disabled" value, never for unset/invalid input — so an absent or malformed
 * config defaults to a sane retention rather than deleting everything.
 */
export function resolveAuditRetention(raw: number | string | undefined): number {
  const parsed = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (Number.isFinite(parsed) && parsed < 0) return 0; // explicit disable
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_AUDIT_RETENTION_DAYS;
}

/**
 * Delete audit rows strictly older than `retentionDays`. Returns the number of
 * rows removed. A retention that is not a positive finite number of days is a
 * NO-OP (returns 0) — callers can never wipe the whole log by passing 0, a
 * negative value, NaN, or forgetting to set a retention.
 */
export function pruneAudit(db: DatabaseSync, retentionDays: number): number {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const cutoff = new Date(cutoffMs).toISOString();
  const result = db.prepare("DELETE FROM audit_events WHERE at < ?").run(cutoff);
  return Number(result.changes);
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
