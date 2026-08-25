import type { DatabaseSync } from "node:sqlite";
import { migratePortal } from "../portal";
import { migrateSetupState, seedSetupState } from "../setup-state";

export function migrate(db: DatabaseSync) {
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
    CREATE INDEX IF NOT EXISTS idx_audit_events_at ON audit_events(at);
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
      last_sync_at TEXT,
      last_error TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT ''
    );
  `);
  ensureColumn(db, "ad_settings", "last_sync_at", "TEXT");
  ensureColumn(db, "devices", "agent_version", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "devices", "last_seen_at", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "devices", "update_requested_at", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "requests", "risk_level", "TEXT NOT NULL DEFAULT 'medium'");
  ensureColumn(db, "requests", "risk_reasons", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "oauth_state", "kind", "TEXT NOT NULL DEFAULT 'pkce'");
  ensureColumn(db, "oauth_state", "meta", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, "jit_grants", "group_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "jit_grants", "member_ids_json", "TEXT NOT NULL DEFAULT '[]'");
  migratePortal(db);
  migrateSetupState(db);
  seedSetupState(db);
}

function ensureColumn(db: DatabaseSync, table: string, column: string, spec: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${spec}`);
  }
}
