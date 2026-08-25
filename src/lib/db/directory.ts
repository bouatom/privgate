import type { DatabaseSync } from "node:sqlite";
import type { DirectoryGroup, DirectorySettings, OauthState } from "./types";

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

/** Flat user→group rows so callers can classify users by real membership. */
export function listGroupMemberships(
  db: DatabaseSync,
): Array<{ userId: string; groupId: string; groupName: string; objectId: string }> {
  const rows = db
    .prepare(
      `SELECT m.user_id, g.id AS group_id, g.name AS group_name, g.object_id
       FROM group_members m JOIN groups g ON g.id = m.group_id`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((row) => ({
    userId: String(row.user_id),
    groupId: String(row.group_id),
    groupName: String(row.group_name),
    objectId: String(row.object_id ?? ""),
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
