import "server-only";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { consumeBootstrap } from "../bootstrap";
import { applyFactoryResetIfNeeded } from "../first-run";
import { registerShutdownHook } from "../lifecycle/shutdown";
import { migrate } from "./schema";
import { purgeDemoFixtures, seedDemo } from "./seed";

const globalDb = globalThis as unknown as { __privgateDb?: DatabaseSync; __privgateDbPath?: string };

export function dbPath(): string {
  return process.env.PRIVGATE_DB || path.join(process.cwd(), "data", "privgate.db");
}

export function getDb(): DatabaseSync {
  const target = dbPath();
  if (globalDb.__privgateDb && globalDb.__privgateDbPath === target) {
    try {
      globalDb.__privgateDb.prepare("SELECT 1 FROM portal_users LIMIT 0").all();
      return globalDb.__privgateDb;
    } catch {
      try {
        globalDb.__privgateDb.close();
      } catch {
        /* ignore */
      }
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
  db.exec("PRAGMA busy_timeout = 5000;");
  // Fail-closed integrity gate: a corrupt DB must never serve stale decisions.
  // Beelzebub quick_check covers the on-disk pages without the full freelist
  // walk, so the one-time boot cost stays trivial; anything but "ok" aborts.
  // Tradeoff: we trade a few ms at startup for the guarantee that a damaged
  // store forces an operator to restore from backup rather than trust it.
  if (target !== ":memory:") {
    const rows = db.prepare("PRAGMA quick_check;").all();
    const status = rows[0] && (rows[0] as { quick_check: string }).quick_check;
    if (status !== "ok") {
      console.error(`[privgate] database integrity check FAILED (${target}): ${status}`);
      try {
        db.close();
      } catch {
        /* ignore */
      }
      throw new Error(`database integrity check failed: ${status}`);
    }
  }
  migrate(db);
  purgeDemoFixtures(db);
  applyFactoryResetIfNeeded(db);
  consumeBootstrap(db);
  // SIGTERM path: checkpoint + close the WAL before package managers swap files.
  registerShutdownHook("database", () => {
    try {
      db.close();
    } catch {
      // already closed
    }
    globalDb.__privgateDb = undefined;
    globalDb.__privgateDbPath = undefined;
  });
  globalDb.__privgateDb = db;
  globalDb.__privgateDbPath = target;
  return db;
}

export function resetDbForTests(target = ":memory:", options: { seedDemo?: boolean } = {}): DatabaseSync {
  globalDb.__privgateDb?.close?.();
  globalDb.__privgateDb = undefined;
  globalDb.__privgateDbPath = undefined;
  process.env.PRIVGATE_DB = target;
  const db = getDb();
  if (options.seedDemo !== false) seedDemo(db);
  return db;
}
