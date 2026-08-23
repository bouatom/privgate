import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { encryptSecret } from "../crypto-secret";
import { deviceSecretKey } from "../secrets";
import { appendAudit } from "./audit";

const DEMO_UPNS = ["ada@contoso.test", "riley@contoso.test"] as const;
const DEMO_USER_IDS = ["user-admin", "user-staff"] as const;
const DEMO_DEVICE_ID = "dev-lab-01";
const DEMO_DEVICE_HOST = "LAB-W11-01";
const DEMO_POLICY_ID = "pol-widget";
const DEMO_GROUP_ID = "g-helpdesk";
const DEMO_REQUEST_IDS = ["req-pending-1", "req-approved-1", "req-denied-1"] as const;

export function fixturesAllowed(env: NodeJS.Dict<string | undefined> = process.env): boolean {
  if (env.PRIVGATE_ALLOW_FIXTURES === "0") return false;
  if (env.PRIVGATE_ALLOW_FIXTURES === "1") return true;
  return env.VITEST === "true" || env.NODE_ENV === "test";
}

/** Fixture data for unit tests only. Production databases start empty. */
export function seedDemo(db: DatabaseSync, env: NodeJS.Dict<string | undefined> = process.env) {
  if (!fixturesAllowed(env)) {
    throw new Error("Demo fixtures cannot be loaded in production");
  }
  const count = db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  if (count.c > 0) return;

  const adminId = DEMO_USER_IDS[0];
  const staffId = DEMO_USER_IDS[1];
  const deviceId = DEMO_DEVICE_ID;
  const now = new Date().toISOString();
  const secretKey = deviceSecretKey();
  const deviceSecret = "lab-device-secret-do-not-use-in-prod";

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
  ).run(deviceId, DEMO_DEVICE_HOST, "hybrid", encryptSecret(deviceSecret, secretKey), now);

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

  appendAudit(db, "system", "seed", "database", { note: "test fixture identities and one pending request" });
  appendAudit(db, `device:${deviceId}`, "device.enroll", deviceId, { hostname: "LAB-W11-01", seed: true });
}

/**
 * Strip lab identities left behind by older builds that called seedDemo on
 * first boot. Safe to run on every production open.
 */
export function purgeDemoFixtures(db: DatabaseSync, env: NodeJS.Dict<string | undefined> = process.env) {
  if (fixturesAllowed(env)) return;

  const userIn = DEMO_USER_IDS.map(() => "?").join(",");
  const upnIn = DEMO_UPNS.map(() => "?").join(",");
  const reqIn = DEMO_REQUEST_IDS.map(() => "?").join(",");
  const before = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE id IN (${userIn}) OR upn IN (${upnIn})`).get(
    ...DEMO_USER_IDS,
    ...DEMO_UPNS,
  ) as { c: number };

  db.exec("BEGIN");
  try {
    db.prepare(`DELETE FROM group_members WHERE user_id IN (${userIn}) OR group_id = ?`).run(
      ...DEMO_USER_IDS,
      DEMO_GROUP_ID,
    );
    db.prepare(`DELETE FROM jit_grants WHERE user_id IN (${userIn}) OR device_id = ?`).run(
      ...DEMO_USER_IDS,
      DEMO_DEVICE_ID,
    );
    db.prepare(
      `DELETE FROM requests WHERE id IN (${reqIn}) OR user_id IN (${userIn}) OR device_id = ?`,
    ).run(...DEMO_REQUEST_IDS, ...DEMO_USER_IDS, DEMO_DEVICE_ID);
    db.prepare("DELETE FROM devices WHERE id = ? OR hostname = ?").run(DEMO_DEVICE_ID, DEMO_DEVICE_HOST);
    db.prepare("DELETE FROM policies WHERE id = ?").run(DEMO_POLICY_ID);
    db.prepare(`DELETE FROM users WHERE id IN (${userIn}) OR upn IN (${upnIn})`).run(...DEMO_USER_IDS, ...DEMO_UPNS);
    db.prepare("DELETE FROM groups WHERE id = ?").run(DEMO_GROUP_ID);
    db.prepare("UPDATE notification_settings SET recipients = '' WHERE recipients = ?").run("ada@contoso.test");
    db.prepare("DELETE FROM audit_events WHERE action = ? OR details LIKE ?").run("seed", "%test fixture%");
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  if (Number(before.c) > 0) {
    appendAudit(db, "system", "seed.purge", "database", { note: "removed leftover demo identities" });
  }
}
