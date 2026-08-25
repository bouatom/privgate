import "server-only";
import type { DatabaseSync } from "node:sqlite";
import type { UpdateChannel } from "./self-update";
import { normalizeChannel } from "./self-update";

export function migrateSetupState(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS setup_state (
      id TEXT PRIMARY KEY,
      wizard_completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      factory_reset INTEGER NOT NULL DEFAULT 0
    );
  `);
  const cols = (db.prepare("PRAGMA table_info(setup_state)").all() as { name: string }[]).map((row) => row.name);
  if (!cols.includes("factory_reset")) {
    db.exec("ALTER TABLE setup_state ADD COLUMN factory_reset INTEGER NOT NULL DEFAULT 0");
  }
  if (!cols.includes("update_channel")) {
    db.exec("ALTER TABLE setup_state ADD COLUMN update_channel TEXT NOT NULL DEFAULT 'official'");
  }
}

/** First-time row only. New consoles always start the welcome wizard. */
export function seedSetupState(db: DatabaseSync) {
  const existing = db.prepare("SELECT 1 AS ok FROM setup_state WHERE id = 'default'").get();
  if (existing) return;
  db.prepare(
    "INSERT INTO setup_state (id, wizard_completed, completed_at, factory_reset) VALUES ('default', 0, NULL, 1)",
  ).run();
}

export function isWizardCompleted(db: DatabaseSync): boolean {
  const row = db.prepare("SELECT wizard_completed FROM setup_state WHERE id = 'default'").get() as
    | { wizard_completed: number }
    | undefined;
  return Number(row?.wizard_completed) === 1;
}

export function completeWizard(db: DatabaseSync) {
  db.prepare(
    `INSERT INTO setup_state (id, wizard_completed, completed_at, factory_reset) VALUES ('default', 1, ?, 1)
     ON CONFLICT(id) DO UPDATE SET wizard_completed = 1, completed_at = excluded.completed_at, factory_reset = 1`,
  ).run(new Date().toISOString());
}

export function wizardPending(db: DatabaseSync, portalNeedsSetup: boolean): boolean {
  return portalNeedsSetup || !isWizardCompleted(db);
}

/** Update channel for the console itself. Singleton row; official is default. */
export function getUpdateChannel(db: DatabaseSync): UpdateChannel {
  const row = db.prepare("SELECT update_channel FROM setup_state WHERE id = 'default'").get() as
    | { update_channel?: unknown }
    | undefined;
  return normalizeChannel(row?.update_channel);
}

export function setUpdateChannel(db: DatabaseSync, channel: UpdateChannel): void {
  db.prepare(
    `INSERT INTO setup_state (id, wizard_completed, completed_at, factory_reset, update_channel)
     VALUES ('default', 0, NULL, 1, ?)
     ON CONFLICT(id) DO UPDATE SET update_channel = excluded.update_channel`,
  ).run(normalizeChannel(channel));
}
