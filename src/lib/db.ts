import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { decryptSecret, encryptSecret } from "./crypto-secret";
import type { Policy, PolicyEffect } from "./policy";
import { migratePortal } from "./portal";
import { deviceSecretKey } from "./secrets";

export type DirectoryUser = {
  id: string;
  displayName: string;
  userPrincipalName: string;
  adSid: string;
  entraOid: string;
  jitEligible: number;
  disabled: number;
  rolesJson: string;
};

export type ElevationRequest = {
  id: string;
  userId: string;
  deviceId: string;
  filePath: string;
  fileHash: string;
  publisher: string;
  arguments: string;
  status: string;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  approvalExpiresAt: string | null;
  riskLevel: string;
  riskReasons: string;
};

export type JitGrant = {
  id: string;
  userId: string;
  deviceId: string;
  durationMinutes: number;
  reason: string;
  startsAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  status: string;
};

export type AuditEvent = {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  details: string;
};

export type Device = {
  id: string;
  hostname: string;
  joinType: string;
  secretEnc: string;
  enrolledAt: string;
};

const globalDb = globalThis as unknown as { __privgateDb?: DatabaseSync; __privgateDbPath?: string };

export function dbPath(): string {
  return process.env.PRIVGATE_DB || path.join(process.cwd(), "data", "privgate.db");
}

export function getDb(): DatabaseSync {
  const target = dbPath();
  if (globalDb.__privgateDb && globalDb.__privgateDbPath === target) {
    // Verify the cached connection is still healthy (portal tables may not exist
    // if the server was started before the migration was wired in).
    try {
      globalDb.__privgateDb.prepare("SELECT 1 FROM portal_users LIMIT 0").all();
      return globalDb.__privgateDb;
    } catch {
      // Stale or missing tables — drop the cache and reconnect.
      try { globalDb.__privgateDb.close(); } catch { /* ignore */ }
      globalDb.__privgateDb = undefined;
      globalDb.__privgateDbPath = undefined;
    }
  }
  if (target !== ":memory:") {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  const db = new DatabaseSync(target);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  seed(db);
  globalDb.__privgateDb = db;
  globalDb.__privgateDbPath = target;
  return db;
}

export function resetDbForTests(target = ":memory:"): DatabaseSync {
  globalDb.__privgateDb?.close?.();
  globalDb.__privgateDb = undefined;
  globalDb.__privgateDbPath = undefined;
  process.env.PRIVGATE_DB = target;
  return getDb();
}

function migrate(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      upn TEXT NOT NULL UNIQUE,
      ad_sid TEXT NOT NULL DEFAULT '',
      entra_oid TEXT NOT NULL DEFAULT '',
      jit_eligible INTEGER NOT NULL DEFAULT 0,
      disabled INTEGER NOT NULL DEFAULT 0,
      roles_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      directory_source TEXT NOT NULL,
      object_id TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (group_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      effect TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      publisher TEXT NOT NULL,
      file_name TEXT NOT NULL DEFAULT '',
      argument_pattern TEXT NOT NULL DEFAULT '',
      bind_type TEXT NOT NULL DEFAULT 'all',
      bind_id TEXT NOT NULL DEFAULT '',
      child_processes TEXT NOT NULL DEFAULT 'deny',
      high_risk_exception INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      hostname TEXT NOT NULL,
      join_type TEXT NOT NULL DEFAULT 'hybrid',
      secret_enc TEXT NOT NULL,
      enrolled_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      publisher TEXT NOT NULL,
      arguments TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      decided_at TEXT,
      decided_by TEXT,
      approval_expires_at TEXT
    );
    CREATE TABLE IF NOT EXISTS jit_grants (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      reason TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      revoked_by TEXT,
      status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      details TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS consumed_nonces (
      nonce TEXT PRIMARY KEY,
      consumed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS directory_settings (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT '',
      tenant_name TEXT NOT NULL DEFAULT '',
      setup_client_id TEXT NOT NULL DEFAULT '',
      daemon_app_id TEXT NOT NULL DEFAULT '',
      daemon_object_id TEXT NOT NULL DEFAULT '',
      secret_enc TEXT NOT NULL DEFAULT '',
      connected_at TEXT,
      last_sync_at TEXT,
      connected_by TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS oauth_state (
      state TEXT PRIMARY KEY,
      verifier TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notification_settings (
      id TEXT PRIMARY KEY,
      email_enabled INTEGER NOT NULL DEFAULT 0,
      smtp_host TEXT NOT NULL DEFAULT '',
      smtp_port INTEGER NOT NULL DEFAULT 587,
      smtp_secure INTEGER NOT NULL DEFAULT 0,
      smtp_user TEXT NOT NULL DEFAULT '',
      smtp_pass_enc TEXT NOT NULL DEFAULT '',
      smtp_from TEXT NOT NULL DEFAULT '',
      recipients TEXT NOT NULL DEFAULT '',
      webhook_enabled INTEGER NOT NULL DEFAULT 0,
      webhook_url TEXT NOT NULL DEFAULT '',
      on_pending INTEGER NOT NULL DEFAULT 1,
      on_approved INTEGER NOT NULL DEFAULT 1,
      on_denied INTEGER NOT NULL DEFAULT 1,
      on_jit INTEGER NOT NULL DEFAULT 1,
      critical_only INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS ad_settings (
      id TEXT PRIMARY KEY,
      host TEXT NOT NULL DEFAULT '',
      port INTEGER NOT NULL DEFAULT 636,
      use_tls INTEGER NOT NULL DEFAULT 1,
      bind_dn TEXT NOT NULL DEFAULT '',
      password_enc TEXT NOT NULL DEFAULT '',
      base_dn TEXT NOT NULL DEFAULT '',
      user_filter TEXT NOT NULL DEFAULT '',
      last_tested_at TEXT,
      last_error TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT ''
    );
  `);
  ensureColumn(db, "requests", "risk_level", "TEXT NOT NULL DEFAULT 'medium'");
  ensureColumn(db, "requests", "risk_reasons", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "oauth_state", "kind", "TEXT NOT NULL DEFAULT 'pkce'");
  ensureColumn(db, "oauth_state", "meta", "TEXT NOT NULL DEFAULT '{}'");
  migratePortal(db);
}

function ensureColumn(db: DatabaseSync, table: string, column: string, spec: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${spec}`);
  }
}

function seed(db: DatabaseSync) {
  const count = db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  if (count.c > 0) return;

  const adminId = "user-admin";
  const staffId = "user-staff";
  const deviceId = "dev-lab-01";
  const now = new Date().toISOString();
  const secretKey = deviceSecretKey();
  // The lab secret is published in agent/appsettings.json so the sample broker can
  // talk to `npm run dev`. A production database must never be seeded with it.
  const deviceSecret =
    process.env.NODE_ENV === "production"
      ? randomBytes(32).toString("base64url")
      : "lab-device-secret-do-not-use-in-prod";

  db.prepare(
    `INSERT INTO users (id, display_name, upn, ad_sid, entra_oid, jit_eligible, disabled, roles_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    adminId,
    "Ada Admin",
    "ada@contoso.test",
    "S-1-5-21-1000-1000-1000-500",
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    1,
    0,
    JSON.stringify(["Approver", "PolicyAdmin"]),
  );
  db.prepare(
    `INSERT INTO users (id, display_name, upn, ad_sid, entra_oid, jit_eligible, disabled, roles_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    staffId,
    "Riley Regular",
    "riley@contoso.test",
    "S-1-5-21-1000-1000-1000-1101",
    "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    1,
    0,
    JSON.stringify([]),
  );
  db.prepare(
    `INSERT INTO devices (id, hostname, join_type, secret_enc, enrolled_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(deviceId, "LAB-W11-01", "hybrid", encryptSecret(deviceSecret, secretKey), now);

  const allowHash = createHash("sha256").update("contoso-widget-msi").digest("hex");
  db.prepare(
    `INSERT INTO policies (id, name, effect, file_hash, publisher, file_name, argument_pattern, bind_type, bind_id, child_processes, high_risk_exception, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "pol-widget",
    "Contoso Widget installer",
    "allow",
    allowHash,
    "CN=Contoso Code Signing",
    "WidgetSetup.msi",
    "",
    "all",
    "",
    "deny",
    0,
    now,
  );

  db.prepare(
    `INSERT INTO requests (id, user_id, device_id, file_path, file_hash, publisher, arguments, status, requested_at, risk_level, risk_reasons)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "req-pending-1",
    staffId,
    deviceId,
    "C:\\\\Program Files\\\\Vendor\\\\Update.exe",
    createHash("sha256").update("unknown-update").digest("hex"),
    "CN=Vendor Inc",
    "",
    "pending",
    now,
    "medium",
    JSON.stringify(["Unknown binary not on the always-allow list"]),
  );

  const approvedAt = new Date(Date.now() - 36 * 3600_000).toISOString();
  const approvedDecided = new Date(Date.now() - 35 * 3600_000).toISOString();
  db.prepare(
    `INSERT INTO requests (id, user_id, device_id, file_path, file_hash, publisher, arguments, status, requested_at, decided_at, decided_by, approval_expires_at, risk_level, risk_reasons)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "req-approved-1",
    staffId,
    deviceId,
    "C:\\\\Program Files\\\\Vendor\\\\PrinterSetup.msi",
    createHash("sha256").update("printer-setup").digest("hex"),
    "CN=Vendor Inc",
    "",
    "approved",
    approvedAt,
    approvedDecided,
    "ada@contoso.test",
    new Date(Date.now() - 34 * 3600_000).toISOString(),
    "low",
    JSON.stringify(["Signed installer already reviewed"]),
  );

  const deniedAt = new Date(Date.now() - 20 * 3600_000).toISOString();
  db.prepare(
    `INSERT INTO requests (id, user_id, device_id, file_path, file_hash, publisher, arguments, status, requested_at, decided_at, decided_by, risk_level, risk_reasons)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "req-denied-1",
    staffId,
    deviceId,
    "C:\\\\Users\\\\riley\\\\Downloads\\\\unknown.exe",
    createHash("sha256").update("unknown-dl").digest("hex"),
    "dry-run",
    "",
    "denied",
    deniedAt,
    new Date(Date.now() - 19 * 3600_000).toISOString(),
    "ada@contoso.test",
    "high",
    JSON.stringify(["No Authenticode publisher — file may be unsigned or swapped", "Path is in a user-writable location (Downloads, AppData, Temp, Desktop)"]),
  );

  db.prepare(
    `INSERT INTO notification_settings (id, email_enabled, smtp_port, recipients, on_pending, on_approved, on_denied, on_jit, critical_only)
     VALUES ('default', 0, 587, 'ada@contoso.test', 1, 1, 1, 1, 0)`,
  ).run();

  db.prepare(`INSERT INTO groups (id, name, directory_source, object_id) VALUES (?, ?, ?, ?)`).run(
    "g-helpdesk",
    "Helpdesk",
    "seed",
    "",
  );
  db.prepare(`INSERT INTO group_members (group_id, user_id) VALUES (?, ?)`).run("g-helpdesk", staffId);

  appendAudit(db, "system", "seed", "database", { note: "demo identities and one pending request" });
  appendAudit(db, `device:${deviceId}`, "device.enroll", deviceId, { hostname: "LAB-W11-01", seed: true });
}

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

export function rowUser(row: Record<string, unknown>): DirectoryUser {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    userPrincipalName: String(row.upn),
    adSid: String(row.ad_sid),
    entraOid: String(row.entra_oid),
    jitEligible: Number(row.jit_eligible),
    disabled: Number(row.disabled),
    rolesJson: String(row.roles_json),
  };
}

export function listUsers(db: DatabaseSync): DirectoryUser[] {
  const rows = db.prepare("SELECT * FROM users ORDER BY display_name").all() as Record<string, unknown>[];
  return rows.map(rowUser);
}

export function getUserByUpn(db: DatabaseSync, upn: string): DirectoryUser | undefined {
  const row = db.prepare("SELECT * FROM users WHERE lower(upn) = lower(?)").get(upn) as
    | Record<string, unknown>
    | undefined;
  return row ? rowUser(row) : undefined;
}

export function getUser(db: DatabaseSync, id: string): DirectoryUser | undefined {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowUser(row) : undefined;
}

export function findUserBySid(db: DatabaseSync, sid: string, entraOid?: string): DirectoryUser | undefined {
  const row = db
    .prepare("SELECT * FROM users WHERE ad_sid = ? OR ( ? != '' AND entra_oid = ? )")
    .get(sid, entraOid ?? "", entraOid ?? "") as Record<string, unknown> | undefined;
  return row ? rowUser(row) : undefined;
}

export function upsertUsers(
  db: DatabaseSync,
  users: Array<{
    displayName: string;
    userPrincipalName: string;
    adSid?: string;
    entraOid?: string;
    jitEligible?: boolean;
    roles?: string[];
  }>,
) {
  const stmt = db.prepare(
    `INSERT INTO users (id, display_name, upn, ad_sid, entra_oid, jit_eligible, disabled, roles_json)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT(upn) DO UPDATE SET
       display_name = excluded.display_name,
       ad_sid = excluded.ad_sid,
       entra_oid = excluded.entra_oid,
       jit_eligible = excluded.jit_eligible,
       roles_json = excluded.roles_json`,
  );
  for (const user of users) {
    const existing = getUserByUpn(db, user.userPrincipalName);
    const jit =
      user.jitEligible === undefined ? (existing?.jitEligible ?? 0) : user.jitEligible ? 1 : 0;
    stmt.run(
      existing?.id ?? randomUUID(),
      user.displayName,
      user.userPrincipalName,
      user.adSid ?? existing?.adSid ?? "",
      user.entraOid ?? existing?.entraOid ?? "",
      jit,
      JSON.stringify(user.roles ?? (existing ? JSON.parse(existing.rolesJson) : [])),
    );
  }
}

export function patchUser(
  db: DatabaseSync,
  id: string,
  patch: { jitEligible?: boolean; disabled?: boolean },
): DirectoryUser | undefined {
  const current = getUser(db, id);
  if (!current) return undefined;
  db.prepare("UPDATE users SET jit_eligible = ?, disabled = ? WHERE id = ?").run(
    patch.jitEligible === undefined ? current.jitEligible : patch.jitEligible ? 1 : 0,
    patch.disabled === undefined ? current.disabled : patch.disabled ? 1 : 0,
    id,
  );
  return getUser(db, id);
}

export function groupIdsForUser(db: DatabaseSync, userId: string): string[] {
  const rows = db.prepare("SELECT group_id FROM group_members WHERE user_id = ?").all(userId) as {
    group_id: string;
  }[];
  return rows.map((r) => r.group_id);
}

export function listPolicies(db: DatabaseSync): Policy[] {
  const rows = db.prepare("SELECT * FROM policies ORDER BY name").all() as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    effect: String(row.effect) as PolicyEffect,
    fileHash: String(row.file_hash),
    publisher: String(row.publisher),
    fileName: String(row.file_name) || undefined,
    argumentPattern: String(row.argument_pattern) || undefined,
    bindType: String(row.bind_type) as Policy["bindType"],
    bindId: String(row.bind_id) || undefined,
    childProcesses: (String(row.child_processes) as "deny" | "allow") || "deny",
    highRiskException: Number(row.high_risk_exception) === 1,
  }));
}

export function insertPolicy(db: DatabaseSync, policy: Policy) {
  db.prepare(
    `INSERT INTO policies (id, name, effect, file_hash, publisher, file_name, argument_pattern, bind_type, bind_id, child_processes, high_risk_exception, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    policy.id,
    policy.name,
    policy.effect,
    policy.fileHash.toLowerCase(),
    policy.publisher,
    policy.fileName ?? "",
    policy.argumentPattern ?? "",
    policy.bindType,
    policy.bindId ?? "",
    policy.childProcesses,
    policy.highRiskException ? 1 : 0,
    new Date().toISOString(),
  );
}

export function deletePolicy(db: DatabaseSync, id: string): boolean {
  const result = db.prepare("DELETE FROM policies WHERE id = ?").run(id);
  return Number(result.changes) > 0;
}

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

function requestFromRow(row: Record<string, unknown>): ElevationRequest {
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
    riskLevel?: string;
    riskReasons?: string;
  },
): ElevationRequest {
  const existing = db
    .prepare(
      `SELECT * FROM requests WHERE user_id = ? AND device_id = ? AND file_hash = ? AND status = 'pending'`,
    )
    .get(req.userId, req.deviceId, req.fileHash) as Record<string, unknown> | undefined;
  if (existing) return getRequest(db, String(existing.id))!;
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO requests (id, user_id, device_id, file_path, file_hash, publisher, arguments, status, requested_at, risk_level, risk_reasons)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    req.userId,
    req.deviceId,
    req.filePath,
    req.fileHash,
    req.publisher,
    req.arguments,
    req.status ?? "pending",
    now,
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
  const current = getRequest(db, id);
  if (!current || current.status !== "pending") return undefined;
  const now = new Date();
  const expires = new Date(now.getTime() + ttlMinutes * 60_000).toISOString();
  db.prepare(
    `UPDATE requests SET status = ?, decided_at = ?, decided_by = ?, approval_expires_at = ? WHERE id = ?`,
  ).run(status, now.toISOString(), actor, status === "approved" ? expires : null, id);
  return getRequest(db, id);
}

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

function jitFromRow(row: Record<string, unknown>): JitGrant {
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
  return rows.map((row) => ({
    id: String(row.id),
    at: String(row.at),
    actor: String(row.actor),
    action: String(row.action),
    target: String(row.target),
    details: String(row.details),
  }));
}

export function listDevices(db: DatabaseSync): Array<Omit<Device, "secretEnc"> & { hostname: string }> {
  const rows = db.prepare("SELECT id, hostname, join_type, enrolled_at FROM devices ORDER BY hostname").all() as Record<
    string,
    unknown
  >[];
  return rows.map((row) => ({
    id: String(row.id),
    hostname: String(row.hostname),
    joinType: String(row.join_type),
    enrolledAt: String(row.enrolled_at),
    secretEnc: "",
  }));
}

export type DeviceSummary = {
  id: string;
  hostname: string;
  joinType: string;
  enrolledAt: string;
  pendingRequests: number;
  activeJit: number;
  lastEventAt: string | null;
  lastAction: string | null;
};

export function listDeviceSummaries(db: DatabaseSync): DeviceSummary[] {
  const rows = db
    .prepare(
      `SELECT d.id, d.hostname, d.join_type, d.enrolled_at,
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
  }));
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
  return rows.map((row) => ({
    id: String(row.id),
    at: String(row.at),
    actor: String(row.actor),
    action: String(row.action),
    target: String(row.target),
    details: String(row.details),
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
    events: listAuditForDevice(db, deviceId).map((e) => ({
      ...e,
      details: JSON.parse(e.details || "{}") as Record<string, unknown>,
    })),
    requests: listRequests(db).filter((r) => r.deviceId === deviceId),
    jit: listJit(db).filter((g) => g.deviceId === deviceId),
  };
}

export function getDevice(db: DatabaseSync, id: string): Device | undefined {
  const row = db.prepare("SELECT * FROM devices WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return {
    id: String(row.id),
    hostname: String(row.hostname),
    joinType: String(row.join_type),
    secretEnc: String(row.secret_enc),
    enrolledAt: String(row.enrolled_at),
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
    joinType || "hybrid",
    encryptSecret(secret, secretKey),
    new Date().toISOString(),
  );
  return { id, secret, hostname };
}

export function consumeNonce(db: DatabaseSync, nonce: string): boolean {
  try {
    db.prepare("INSERT INTO consumed_nonces (nonce, consumed_at) VALUES (?, ?)").run(nonce, new Date().toISOString());
    return true;
  } catch {
    return false;
  }
}

export type DirectorySettings = {
  tenantId: string;
  tenantName: string;
  setupClientId: string;
  daemonAppId: string;
  daemonObjectId: string;
  secretEnc: string;
  connectedAt: string | null;
  lastSyncAt: string | null;
  connectedBy: string;
};

export function getDirectorySettings(db: DatabaseSync): DirectorySettings | undefined {
  const row = db.prepare("SELECT * FROM directory_settings WHERE id = 'default'").get() as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;
  return {
    tenantId: String(row.tenant_id),
    tenantName: String(row.tenant_name),
    setupClientId: String(row.setup_client_id),
    daemonAppId: String(row.daemon_app_id),
    daemonObjectId: String(row.daemon_object_id),
    secretEnc: String(row.secret_enc),
    connectedAt: row.connected_at ? String(row.connected_at) : null,
    lastSyncAt: row.last_sync_at ? String(row.last_sync_at) : null,
    connectedBy: String(row.connected_by),
  };
}

export function saveDirectorySettings(db: DatabaseSync, settings: DirectorySettings) {
  db.prepare(
    `INSERT INTO directory_settings (id, tenant_id, tenant_name, setup_client_id, daemon_app_id, daemon_object_id, secret_enc, connected_at, last_sync_at, connected_by)
     VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       tenant_id = excluded.tenant_id,
       tenant_name = excluded.tenant_name,
       setup_client_id = excluded.setup_client_id,
       daemon_app_id = excluded.daemon_app_id,
       daemon_object_id = excluded.daemon_object_id,
       secret_enc = excluded.secret_enc,
       connected_at = excluded.connected_at,
       last_sync_at = excluded.last_sync_at,
       connected_by = excluded.connected_by`,
  ).run(
    settings.tenantId,
    settings.tenantName,
    settings.setupClientId,
    settings.daemonAppId,
    settings.daemonObjectId,
    settings.secretEnc,
    settings.connectedAt,
    settings.lastSyncAt,
    settings.connectedBy,
  );
}

export type OauthState = {
  state: string;
  verifier: string;
  kind: string;
  meta: string;
  createdAt: string;
};

export function saveOauthState(
  db: DatabaseSync,
  state: string,
  verifier: string,
  kind = "pkce",
  meta: Record<string, unknown> = {},
) {
  db.prepare(
    "INSERT OR REPLACE INTO oauth_state (state, verifier, created_at, kind, meta) VALUES (?, ?, ?, ?, ?)",
  ).run(state, verifier, new Date().toISOString(), kind, JSON.stringify(meta));
}

export function getOauthState(db: DatabaseSync, state: string): OauthState | undefined {
  const row = db.prepare("SELECT * FROM oauth_state WHERE state = ?").get(state) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return {
    state: String(row.state),
    verifier: String(row.verifier),
    kind: String(row.kind || "pkce"),
    meta: String(row.meta || "{}"),
    createdAt: String(row.created_at),
  };
}

export function deleteOauthState(db: DatabaseSync, state: string) {
  db.prepare("DELETE FROM oauth_state WHERE state = ?").run(state);
}

export function takeOauthState(db: DatabaseSync, state: string): OauthState | undefined {
  const row = getOauthState(db, state);
  if (!row) return undefined;
  deleteOauthState(db, state);
  return row;
}

export type DirectoryGroup = {
  id: string;
  name: string;
  directorySource: string;
  objectId: string;
  memberCount: number;
};

export function listGroups(db: DatabaseSync): DirectoryGroup[] {
  const rows = db
    .prepare(
      `SELECT g.*, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS member_count
       FROM groups g ORDER BY g.name`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    directorySource: String(row.directory_source),
    objectId: String(row.object_id),
    memberCount: Number(row.member_count),
  }));
}

export function replaceGroups(
  db: DatabaseSync,
  groups: Array<{ id: string; name: string; objectId: string; memberUserIds: string[] }>,
) {
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM group_members");
    db.exec("DELETE FROM groups");
    const insertG = db.prepare(
      `INSERT INTO groups (id, name, directory_source, object_id) VALUES (?, ?, 'entra', ?)`,
    );
    const insertM = db.prepare(`INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)`);
    for (const group of groups) {
      insertG.run(group.id, group.name, group.objectId);
      for (const userId of group.memberUserIds) insertM.run(group.id, userId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export type NotificationSettings = {
  emailEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpFrom: string;
  recipients: string;
  passwordSet: boolean;
  webhookEnabled: boolean;
  webhookUrl: string;
  onPending: boolean;
  onApproved: boolean;
  onDenied: boolean;
  onJit: boolean;
  criticalOnly: boolean;
};

const notificationDefaults: NotificationSettings = {
  emailEnabled: false,
  smtpHost: "",
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: "",
  smtpFrom: "",
  recipients: "",
  passwordSet: false,
  webhookEnabled: false,
  webhookUrl: "",
  onPending: true,
  onApproved: true,
  onDenied: true,
  onJit: true,
  criticalOnly: false,
};

function secretKey() {
  return deviceSecretKey();
}

export function getNotificationSettings(db: DatabaseSync): NotificationSettings {
  const row = db.prepare("SELECT * FROM notification_settings WHERE id = 'default'").get() as
    | Record<string, unknown>
    | undefined;
  if (!row) return { ...notificationDefaults };
  return {
    emailEnabled: Number(row.email_enabled) === 1,
    smtpHost: String(row.smtp_host || ""),
    smtpPort: Number(row.smtp_port || 587),
    smtpSecure: Number(row.smtp_secure) === 1,
    smtpUser: String(row.smtp_user || ""),
    smtpFrom: String(row.smtp_from || ""),
    recipients: String(row.recipients || ""),
    passwordSet: Boolean(row.smtp_pass_enc),
    webhookEnabled: Number(row.webhook_enabled) === 1,
    webhookUrl: String(row.webhook_url || ""),
    onPending: Number(row.on_pending) === 1,
    onApproved: Number(row.on_approved) === 1,
    onDenied: Number(row.on_denied) === 1,
    onJit: Number(row.on_jit) === 1,
    criticalOnly: Number(row.critical_only) === 1,
  };
}

export function getNotificationSecrets(db: DatabaseSync): { smtpPass: string } {
  const row = db.prepare("SELECT smtp_pass_enc FROM notification_settings WHERE id = 'default'").get() as
    | { smtp_pass_enc?: string }
    | undefined;
  if (!row?.smtp_pass_enc) return { smtpPass: "" };
  try {
    return { smtpPass: decryptSecret(String(row.smtp_pass_enc), secretKey()) };
  } catch {
    return { smtpPass: "" };
  }
}

export function saveNotificationSettings(
  db: DatabaseSync,
  patch: Partial<NotificationSettings> & { smtpPass?: string },
) {
  const current = getNotificationSettings(db);
  const next = { ...current, ...patch };
  const existing = db.prepare("SELECT smtp_pass_enc FROM notification_settings WHERE id = 'default'").get() as
    | { smtp_pass_enc?: string }
    | undefined;
  let passEnc = existing?.smtp_pass_enc || "";
  if (patch.smtpPass) passEnc = encryptSecret(patch.smtpPass, secretKey());
  db.prepare(
    `INSERT INTO notification_settings (
      id, email_enabled, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass_enc, smtp_from, recipients,
      webhook_enabled, webhook_url, on_pending, on_approved, on_denied, on_jit, critical_only
    ) VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email_enabled = excluded.email_enabled,
      smtp_host = excluded.smtp_host,
      smtp_port = excluded.smtp_port,
      smtp_secure = excluded.smtp_secure,
      smtp_user = excluded.smtp_user,
      smtp_pass_enc = excluded.smtp_pass_enc,
      smtp_from = excluded.smtp_from,
      recipients = excluded.recipients,
      webhook_enabled = excluded.webhook_enabled,
      webhook_url = excluded.webhook_url,
      on_pending = excluded.on_pending,
      on_approved = excluded.on_approved,
      on_denied = excluded.on_denied,
      on_jit = excluded.on_jit,
      critical_only = excluded.critical_only`,
  ).run(
    next.emailEnabled ? 1 : 0,
    next.smtpHost,
    next.smtpPort,
    next.smtpSecure ? 1 : 0,
    next.smtpUser,
    passEnc,
    next.smtpFrom,
    next.recipients,
    next.webhookEnabled ? 1 : 0,
    next.webhookUrl,
    next.onPending ? 1 : 0,
    next.onApproved ? 1 : 0,
    next.onDenied ? 1 : 0,
    next.onJit ? 1 : 0,
    next.criticalOnly ? 1 : 0,
  );
}

export type AdSettings = {
  configured: boolean;
  host: string;
  port: number;
  useTls: boolean;
  bindDn: string;
  passwordSet: boolean;
  baseDn: string;
  userFilter: string;
  lastTestedAt: string | null;
  lastError: string;
};

export function getAdSettings(db: DatabaseSync): AdSettings {
  const row = db.prepare("SELECT * FROM ad_settings WHERE id = 'default'").get() as Record<string, unknown> | undefined;
  if (!row) {
    return {
      configured: false,
      host: "",
      port: 636,
      useTls: true,
      bindDn: "",
      passwordSet: false,
      baseDn: "",
      userFilter: "(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))",
      lastTestedAt: null,
      lastError: "",
    };
  }
  return {
    configured: Boolean(row.host),
    host: String(row.host || ""),
    port: Number(row.port || 636),
    useTls: Number(row.use_tls) === 1,
    bindDn: String(row.bind_dn || ""),
    passwordSet: Boolean(row.password_enc),
    baseDn: String(row.base_dn || ""),
    userFilter: String(row.user_filter || ""),
    lastTestedAt: row.last_tested_at ? String(row.last_tested_at) : null,
    lastError: String(row.last_error || ""),
  };
}

export function saveAdSettings(
  db: DatabaseSync,
  patch: Partial<AdSettings> & { password?: string; lastError?: string; lastTestedAt?: string | null },
  actor = "",
) {
  const current = getAdSettings(db);
  const next = { ...current, ...patch };
  const existing = db.prepare("SELECT password_enc FROM ad_settings WHERE id = 'default'").get() as
    | { password_enc?: string }
    | undefined;
  let passEnc = existing?.password_enc || "";
  if (patch.password) passEnc = encryptSecret(patch.password, secretKey());
  db.prepare(
    `INSERT INTO ad_settings (id, host, port, use_tls, bind_dn, password_enc, base_dn, user_filter, last_tested_at, last_error, updated_by)
     VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       host = excluded.host,
       port = excluded.port,
       use_tls = excluded.use_tls,
       bind_dn = excluded.bind_dn,
       password_enc = excluded.password_enc,
       base_dn = excluded.base_dn,
       user_filter = excluded.user_filter,
       last_tested_at = excluded.last_tested_at,
       last_error = excluded.last_error,
       updated_by = excluded.updated_by`,
  ).run(
    next.host,
    next.port,
    next.useTls ? 1 : 0,
    next.bindDn,
    passEnc,
    next.baseDn,
    next.userFilter,
    patch.lastTestedAt === undefined ? current.lastTestedAt : patch.lastTestedAt,
    patch.lastError === undefined ? current.lastError : patch.lastError,
    actor || "",
  );
}
