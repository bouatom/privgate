import "server-only";
import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { bootstrapPath } from "./bootstrap";
import { DEMO_DEVICE_HOST, DEMO_DEVICE_ID } from "./db/seed";
import { countPortalUsers } from "./portal";

const UNUSED_TABLES = [
  "portal_user_roles",
  "portal_users",
  "group_members",
  "jit_grants",
  "requests",
  "devices",
  "policies",
  "users",
  "groups",
  "audit_events",
  "consumed_nonces",
  "oauth_state",
  "directory_settings",
  "ad_settings",
  "notification_settings",
] as const;

function columnNames(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name);
}

function factoryResetPending(db: DatabaseSync): boolean {
  if (!columnNames(db, "setup_state").includes("factory_reset")) return true;
  const row = db.prepare("SELECT factory_reset FROM setup_state WHERE id = 'default'").get() as
    | { factory_reset: number }
    | undefined;
  return !row || Number(row.factory_reset) !== 1;
}

export function deploymentInUse(db: DatabaseSync): boolean {
  const devices = db
    .prepare("SELECT COUNT(*) AS c FROM devices WHERE id != ? AND hostname != ?")
    .get(DEMO_DEVICE_ID, DEMO_DEVICE_HOST) as { c: number };
  const entra = db.prepare("SELECT daemon_app_id FROM directory_settings WHERE id = 'default'").get() as
    | { daemon_app_id?: string }
    | undefined;
  const ad = db.prepare("SELECT host FROM ad_settings WHERE id = 'default'").get() as { host?: string } | undefined;
  return Number(devices.c) > 0 || Boolean(entra?.daemon_app_id) || Boolean(String(ad?.host || "").trim());
}

function discardLeftoverBootstrap() {
  const file = bootstrapPath();
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* leftover file may already be gone */
  }
}

function clearUnusedConsole(db: DatabaseSync) {
  db.exec("BEGIN");
  try {
    for (const table of UNUSED_TABLES) {
      db.exec(`DELETE FROM ${table}`);
    }
    db.prepare(
      `INSERT INTO setup_state (id, wizard_completed, completed_at, factory_reset)
       VALUES ('default', 0, NULL, 1)
       ON CONFLICT(id) DO UPDATE SET wizard_completed = 0, completed_at = NULL, factory_reset = 1`,
    ).run();
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function markFactoryResetDone(db: DatabaseSync) {
  db.prepare(
    `INSERT INTO setup_state (id, wizard_completed, completed_at, factory_reset)
     VALUES ('default', 0, NULL, 1)
     ON CONFLICT(id) DO UPDATE SET factory_reset = 1`,
  ).run();
}

/**
 * One-time cleanup for leftover data dirs from older installers that seeded lab
 * identities or kept a portal user after uninstall. Never runs again after
 * factory_reset=1. Consoles that already enrolled a real device or connected a
 * directory are left untouched.
 */
export function applyFactoryResetIfNeeded(db: DatabaseSync) {
  if (!factoryResetPending(db)) return;
  if (deploymentInUse(db)) {
    markFactoryResetDone(db);
    return;
  }
  discardLeftoverBootstrap();
  clearUnusedConsole(db);
}

export function firstRunNeedsAdmin(db: DatabaseSync): boolean {
  return countPortalUsers(db) < 1;
}
