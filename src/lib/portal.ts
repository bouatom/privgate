import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { hashPassword } from "./passwords";
import {
  ALL_PERMISSIONS,
  PREDEFINED_ROLES,
  isMasterPermissions,
  sanitizePermissions,
  type PermissionId,
} from "./permissions";

export type PortalRole = {
  id: string;
  name: string;
  description: string;
  permissions: PermissionId[];
  system: boolean;
};

export type PortalUser = {
  id: string;
  displayName: string;
  email: string;
  kind: "local" | "sso";
  passwordSet: boolean;
  entraOid: string;
  disabled: boolean;
  createdAt: string;
  roleIds: string[];
  roleNames: string[];
  permissions: PermissionId[];
};

export function migratePortal(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS portal_roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      permissions_json TEXT NOT NULL,
      system INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS portal_users (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      password_hash TEXT NOT NULL DEFAULT '',
      entra_oid TEXT NOT NULL DEFAULT '',
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS portal_user_roles (
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (user_id, role_id)
    );
  `);
  ensurePredefinedRoles(db);
  seedDefaultMaster(db);
}

function ensurePredefinedRoles(db: DatabaseSync) {
  const upsert = db.prepare(
    `INSERT INTO portal_roles (id, name, description, permissions_json, system)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       permissions_json = excluded.permissions_json,
       system = 1`,
  );
  for (const role of PREDEFINED_ROLES) {
    upsert.run(role.id, role.name, role.description, JSON.stringify(role.permissions));
  }
}

function seedDefaultMaster(db: DatabaseSync) {
  const count = db.prepare("SELECT COUNT(*) AS c FROM portal_users").get() as { c: number };
  if (count.c > 0) return;
  const id = "portal-ada";
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO portal_users (id, display_name, email, kind, password_hash, entra_oid, disabled, created_at)
     VALUES (?, ?, ?, 'local', '', '', 0, ?)`,
  ).run(id, "Ada Admin", "ada@contoso.test", now);
  db.prepare("INSERT INTO portal_user_roles (user_id, role_id) VALUES (?, ?)").run(id, "role-master-admin");
}

function roleFromRow(row: Record<string, unknown>): PortalRole {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description || ""),
    permissions: sanitizePermissions(JSON.parse(String(row.permissions_json || "[]"))),
    system: Number(row.system) === 1,
  };
}

export function listRoles(db: DatabaseSync): PortalRole[] {
  const rows = db.prepare("SELECT * FROM portal_roles ORDER BY system DESC, name").all() as Record<string, unknown>[];
  return rows.map(roleFromRow);
}

export function getRole(db: DatabaseSync, id: string): PortalRole | undefined {
  const row = db.prepare("SELECT * FROM portal_roles WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? roleFromRow(row) : undefined;
}

export function createRole(
  db: DatabaseSync,
  input: { name: string; description?: string; permissions: string[] },
): PortalRole | { error: string } {
  const name = input.name.trim();
  if (!name) return { error: "name required" };
  const permissions = sanitizePermissions(input.permissions);
  if (!permissions.length) return { error: "select at least one permission" };
  const id = randomUUID();
  db.prepare(
    `INSERT INTO portal_roles (id, name, description, permissions_json, system) VALUES (?, ?, ?, ?, 0)`,
  ).run(id, name, (input.description || "").trim(), JSON.stringify(permissions));
  return getRole(db, id)!;
}

export function updateRole(
  db: DatabaseSync,
  id: string,
  input: { name?: string; description?: string; permissions?: string[] },
): PortalRole | { error: string } {
  const current = getRole(db, id);
  if (!current) return { error: "unknown role" };
  if (current.system) return { error: "predefined roles cannot be edited" };
  const name = (input.name ?? current.name).trim();
  if (!name) return { error: "name required" };
  const permissions = input.permissions ? sanitizePermissions(input.permissions) : current.permissions;
  if (!permissions.length) return { error: "select at least one permission" };
  db.prepare("UPDATE portal_roles SET name = ?, description = ?, permissions_json = ? WHERE id = ?").run(
    name,
    (input.description ?? current.description).trim(),
    JSON.stringify(permissions),
    id,
  );
  return getRole(db, id)!;
}

export function deleteRole(db: DatabaseSync, id: string): { error: string } | { ok: true } {
  const current = getRole(db, id);
  if (!current) return { error: "unknown role" };
  if (current.system) return { error: "predefined roles cannot be deleted" };
  const assigned = db.prepare("SELECT COUNT(*) AS c FROM portal_user_roles WHERE role_id = ?").get(id) as { c: number };
  if (assigned.c > 0) return { error: "remove this role from all users first" };
  db.prepare("DELETE FROM portal_roles WHERE id = ?").run(id);
  return { ok: true };
}

function userRoleIds(db: DatabaseSync, userId: string): string[] {
  const rows = db.prepare("SELECT role_id FROM portal_user_roles WHERE user_id = ?").all(userId) as { role_id: string }[];
  return rows.map((r) => r.role_id);
}

export function permissionsForRoles(db: DatabaseSync, roleIds: string[]): PermissionId[] {
  if (!roleIds.length) return [];
  const granted = new Set<PermissionId>();
  for (const id of roleIds) {
    const role = getRole(db, id);
    for (const perm of role?.permissions || []) granted.add(perm);
  }
  return ALL_PERMISSIONS.filter((id) => granted.has(id));
}

function presentUser(db: DatabaseSync, row: Record<string, unknown>): PortalUser {
  const id = String(row.id);
  const roleIds = userRoleIds(db, id);
  const roles = roleIds.map((rid) => getRole(db, rid)).filter(Boolean) as PortalRole[];
  return {
    id,
    displayName: String(row.display_name),
    email: String(row.email),
    kind: String(row.kind) === "sso" ? "sso" : "local",
    passwordSet: Boolean(row.password_hash),
    entraOid: String(row.entra_oid || ""),
    disabled: Number(row.disabled) === 1,
    createdAt: String(row.created_at),
    roleIds,
    roleNames: roles.map((r) => r.name),
    permissions: permissionsForRoles(db, roleIds),
  };
}

export function listPortalUsers(db: DatabaseSync): PortalUser[] {
  const rows = db
    .prepare("SELECT * FROM portal_users ORDER BY display_name")
    .all() as Record<string, unknown>[];
  return rows.map((row) => presentUser(db, row));
}

export function getPortalUser(db: DatabaseSync, id: string): PortalUser | undefined {
  const row = db.prepare("SELECT * FROM portal_users WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? presentUser(db, row) : undefined;
}

export function getPortalUserByEmail(db: DatabaseSync, email: string): PortalUser | undefined {
  const row = db.prepare("SELECT * FROM portal_users WHERE lower(email) = lower(?)").get(email) as
    | Record<string, unknown>
    | undefined;
  return row ? presentUser(db, row) : undefined;
}

export function getPortalPasswordHash(db: DatabaseSync, id: string): string {
  const row = db.prepare("SELECT password_hash FROM portal_users WHERE id = ?").get(id) as
    | { password_hash?: string }
    | undefined;
  return String(row?.password_hash || "");
}

function setUserRoles(db: DatabaseSync, userId: string, roleIds: string[]) {
  const unique = [...new Set(roleIds.filter((id) => Boolean(getRole(db, id))))];
  db.prepare("DELETE FROM portal_user_roles WHERE user_id = ?").run(userId);
  const insert = db.prepare("INSERT INTO portal_user_roles (user_id, role_id) VALUES (?, ?)");
  for (const roleId of unique) insert.run(userId, roleId);
}

export function countMasterAdmins(db: DatabaseSync, exceptUserId?: string): number {
  return listPortalUsers(db).filter((u) => {
    if (u.disabled) return false;
    if (exceptUserId && u.id === exceptUserId) return false;
    return isMasterPermissions(u.permissions);
  }).length;
}

function wouldLeaveNoMaster(
  db: DatabaseSync,
  userId: string,
  next: { disabled?: boolean; roleIds?: string[] },
): boolean {
  const current = getPortalUser(db, userId);
  if (!current) return false;
  const disabled = next.disabled ?? current.disabled;
  const roleIds = next.roleIds ?? current.roleIds;
  const nextPerms = disabled ? [] : permissionsForRoles(db, roleIds);
  const stillMaster = !disabled && isMasterPermissions(nextPerms);
  if (stillMaster) return false;
  return countMasterAdmins(db, userId) < 1;
}

export function createPortalUser(
  db: DatabaseSync,
  input: {
    displayName: string;
    email: string;
    kind: "local" | "sso";
    password?: string;
    entraOid?: string;
    roleIds: string[];
  },
): PortalUser | { error: string } {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  if (!displayName) return { error: "name required" };
  if (!email || !email.includes("@")) return { error: "valid email required" };
  if (getPortalUserByEmail(db, email)) return { error: "a portal user with that email already exists" };
  if (!input.roleIds?.length) return { error: "assign at least one role" };
  const unknown = input.roleIds.filter((id) => !getRole(db, id));
  if (unknown.length) return { error: "unknown role" };
  if (input.kind === "local" && !input.password && process.env.NODE_ENV === "production") {
    return { error: "password required for local users" };
  }
  if (input.kind === "sso" && input.password) {
    return { error: "SSO users sign in with Entra ID, not a local password" };
  }
  const id = randomUUID();
  db.prepare(
    `INSERT INTO portal_users (id, display_name, email, kind, password_hash, entra_oid, disabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(
    id,
    displayName,
    email,
    input.kind,
    input.kind === "local" && input.password ? hashPassword(input.password) : "",
    (input.entraOid || "").trim(),
    new Date().toISOString(),
  );
  setUserRoles(db, id, input.roleIds);
  return getPortalUser(db, id)!;
}

export function updatePortalUser(
  db: DatabaseSync,
  id: string,
  input: {
    displayName?: string;
    kind?: "local" | "sso";
    password?: string;
    entraOid?: string;
    disabled?: boolean;
    roleIds?: string[];
  },
): PortalUser | { error: string } {
  const current = getPortalUser(db, id);
  if (!current) return { error: "unknown user" };
  if (wouldLeaveNoMaster(db, id, { disabled: input.disabled, roleIds: input.roleIds })) {
    return { error: "keep at least one enabled Master Admin" };
  }
  const displayName = (input.displayName ?? current.displayName).trim();
  if (!displayName) return { error: "name required" };
  const kind = input.kind ?? current.kind;
  let passwordHash = getPortalPasswordHash(db, id);
  if (kind === "sso") passwordHash = "";
  else if (input.password) passwordHash = hashPassword(input.password);
  const disabled = input.disabled === undefined ? (current.disabled ? 1 : 0) : input.disabled ? 1 : 0;
  db.prepare(
    `UPDATE portal_users SET display_name = ?, kind = ?, password_hash = ?, entra_oid = ?, disabled = ? WHERE id = ?`,
  ).run(displayName, kind, passwordHash, input.entraOid ?? current.entraOid, disabled, id);
  if (input.roleIds) setUserRoles(db, id, input.roleIds);
  return getPortalUser(db, id)!;
}
