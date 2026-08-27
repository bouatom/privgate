import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ElevationRequest } from "./types";

export function listRequests(db: DatabaseSync): Array<ElevationRequest & { userName: string; hostname: string }> {
  const rows = db
    .prepare(
      `SELECT r.*, u.display_name AS user_name, d.hostname
       FROM requests r
       JOIN users u ON u.id = r.user_id
       JOIN devices d ON d.id = r.device_id
       ORDER BY r.requested_at DESC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((row) => ({
    ...requestFromRow(row),
    userName: String(row.user_name),
    hostname: String(row.hostname),
  }));
}

export function requestFromRow(row: Record<string, unknown>): ElevationRequest {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    deviceId: String(row.device_id),
    filePath: String(row.file_path),
    fileHash: String(row.file_hash),
    publisher: String(row.publisher),
    arguments: String(row.arguments),
    status: String(row.status),
    requestedAt: String(row.requested_at),
    decidedAt: row.decided_at ? String(row.decided_at) : null,
    decidedBy: row.decided_by ? String(row.decided_by) : null,
    approvalExpiresAt: row.approval_expires_at ? String(row.approval_expires_at) : null,
    riskLevel: String(row.risk_level || "medium"),
    riskReasons: String(row.risk_reasons || "[]"),
  };
}

export function getRequest(db: DatabaseSync, id: string): ElevationRequest | undefined {
  const row = db.prepare("SELECT * FROM requests WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return requestFromRow(row);
}

export function insertRequest(
  db: DatabaseSync,
  req: Omit<
    ElevationRequest,
    "id" | "requestedAt" | "decidedAt" | "decidedBy" | "approvalExpiresAt" | "status" | "riskLevel" | "riskReasons"
  > & {
    status?: string;
    decidedBy?: string;
    riskLevel?: string;
    riskReasons?: string;
  },
): ElevationRequest {
  const status = req.status ?? "pending";
  if (status === "pending") {
    const existing = db
      .prepare(
        `SELECT * FROM requests WHERE user_id = ? AND device_id = ? AND file_hash = ? AND status = 'pending'`,
      )
      .get(req.userId, req.deviceId, req.fileHash) as Record<string, unknown> | undefined;
    if (existing) return getRequest(db, String(existing.id))!;
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  const decidedAt = status === "pending" ? null : now;
  const decidedBy = status === "pending" ? null : (req.decidedBy ?? "policy");
  db.prepare(
    `INSERT INTO requests (id, user_id, device_id, file_path, file_hash, publisher, arguments, status, requested_at, decided_at, decided_by, risk_level, risk_reasons)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    req.userId,
    req.deviceId,
    req.filePath,
    req.fileHash,
    req.publisher,
    req.arguments,
    status,
    now,
    decidedAt,
    decidedBy,
    req.riskLevel ?? "medium",
    req.riskReasons ?? "[]",
  );
  return getRequest(db, id)!;
}

export function decideRequest(
  db: DatabaseSync,
  id: string,
  status: "approved" | "denied",
  actor: string,
  ttlMinutes = 15,
): ElevationRequest | undefined {
  const now = new Date();
  const expires = new Date(now.getTime() + ttlMinutes * 60_000).toISOString();
  const result = db
    .prepare(
      `UPDATE requests SET status = ?, decided_at = ?, decided_by = ?, approval_expires_at = ? WHERE id = ? AND status = 'pending'`,
    )
    .run(status, now.toISOString(), actor, status === "approved" ? expires : null, id);
  if (Number(result.changes) === 0) return undefined;
  return getRequest(db, id);
}
