import "server-only";
import type { DatabaseSync } from "node:sqlite";

export function migrateSetupState(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS setup_state (
      id TEXT PRIMARY KEY,
      wizard_completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT
    );
  `);
}

/**
 * First-time row only. An existing console that already has an admin plus a
 * directory or enrolled device is treated as past the welcome wizard.
 */
export function seedSetupState(db: DatabaseSync) {
  const existing = db.prepare("SELECT 1 AS ok FROM setup_state WHERE id = 'default'").get();
  if (existing) return;
  const portal = db.prepare("SELECT COUNT(*) AS c FROM portal_users").get() as { c: number };
  const devices = db.prepare("SELECT COUNT(*) AS c FROM devices").get() as { c: number };
  const entra = db.prepare("SELECT daemon_app_id FROM directory_settings WHERE id = 'default'").get() as
    | { daemon_app_id?: string }
    | undefined;
  const ad = db.prepare("SELECT host FROM ad_settings WHERE id = 'default'").get() as { host?: string } | undefined;
  const inUse =
    Number(portal.c) > 0 &&
    (Number(devices.c) > 0 || Boolean(entra?.daemon_app_id) || Boolean(String(ad?.host || "").trim()));
  db.prepare("INSERT INTO setup_state (id, wizard_completed, completed_at) VALUES ('default', ?, ?)").run(
    inUse ? 1 : 0,
    inUse ? new Date().toISOString() : null,
  );
}

export function isWizardCompleted(db: DatabaseSync): boolean {
  const row = db.prepare("SELECT wizard_completed FROM setup_state WHERE id = 'default'").get() as
    | { wizard_completed: number }
    | undefined;
  return Number(row?.wizard_completed) === 1;
}

export function completeWizard(db: DatabaseSync) {
  db.prepare(
    `INSERT INTO setup_state (id, wizard_completed, completed_at) VALUES ('default', 1, ?)
     ON CONFLICT(id) DO UPDATE SET wizard_completed = 1, completed_at = excluded.completed_at`,
  ).run(new Date().toISOString());
}

export function wizardPending(db: DatabaseSync, portalNeedsSetup: boolean): boolean {
  return portalNeedsSetup || !isWizardCompleted(db);
}
