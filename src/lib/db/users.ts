import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DirectoryUser } from "./types";

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
       ad_sid = CASE WHEN excluded.ad_sid != '' THEN excluded.ad_sid ELSE users.ad_sid END,
       entra_oid = CASE WHEN excluded.entra_oid != '' THEN excluded.entra_oid ELSE users.entra_oid END,
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
      (user.adSid || existing?.adSid || "").trim(),
      (user.entraOid || existing?.entraOid || "").trim(),
      jit,
      JSON.stringify(user.roles ?? (existing ? JSON.parse(existing.rolesJson) : [])),
    );
  }
}

/**
 * Directory-user flags the console owns. Disabling directory accounts is out
 * of product scope — elevation control only manages JIT eligibility; the
 * legacy `disabled` column is left untouched by every code path.
 */
export function patchUser(
  db: DatabaseSync,
  id: string,
  patch: { jitEligible?: boolean },
): DirectoryUser | undefined {
  const current = getUser(db, id);
  if (!current) return undefined;
  db.prepare("UPDATE users SET jit_eligible = ? WHERE id = ?").run(
    patch.jitEligible === undefined ? current.jitEligible : patch.jitEligible ? 1 : 0,
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
