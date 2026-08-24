import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { dispatchNotification, queueNotification } from "./notify";
import { sendSmtp } from "./smtp";

vi.mock("./smtp", () => ({ sendSmtp: vi.fn() }));

const sendSmtpMock = vi.mocked(sendSmtp);

function memDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE audit_events (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      details TEXT NOT NULL
    );
    CREATE TABLE notification_settings (
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
  `);
  return db;
}

function auditRows(db: DatabaseSync): Array<{ action: string; target: string; details: string }> {
  return db.prepare("SELECT action, target, details FROM audit_events ORDER BY at").all() as Array<{
    action: string;
    target: string;
    details: string;
  }>;
}

const event = { kind: "pending" as const, title: "[PrivGate] Elevation needs approval: mmc.exe", body: "body" };

beforeEach(() => {
  sendSmtpMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("queueNotification audit trail", () => {
  it("writes a notify.failed audit row when SMTP dispatch throws", async () => {
    const db = memDb();
    db.prepare(
      `INSERT INTO notification_settings (id, email_enabled, smtp_host, recipients)
       VALUES ('default', 1, 'smtp.example.com', 'ops@example.com')`,
    ).run();
    sendSmtpMock.mockRejectedValue(new Error("connection refused"));

    expect(() => queueNotification(db, event)).not.toThrow();
    // queueNotification is fire-and-forget; let its catch handler settle.
    await vi.waitFor(() => {
      expect(auditRows(db)).toHaveLength(1);
    });
    const row = auditRows(db)[0]!;
    expect(row.action).toBe("notify.failed");
    expect(row.target).toBe("pending");
    expect(JSON.parse(row.details)).toMatchObject({ error: "connection refused" });
    await expect(dispatchNotification(db, event)).rejects.toThrow("connection refused");
  });

  it("writes a notify.failed audit row when the webhook fetch rejects", async () => {
    const db = memDb();
    db.prepare(
      `INSERT INTO notification_settings (id, webhook_enabled, webhook_url)
       VALUES ('default', 1, 'https://hooks.example.com/nope')`,
    ).run();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      }),
    );

    expect(() => queueNotification(db, event)).not.toThrow();
    await vi.waitFor(() => {
      expect(auditRows(db)).toHaveLength(1);
    });
    const row = auditRows(db)[0]!;
    expect(row.action).toBe("notify.failed");
    expect(JSON.parse(row.details)).toMatchObject({ error: "getaddrinfo ENOTFOUND" });
  });

  it("does not audit when delivery succeeds", async () => {
    const db = memDb();
    db.prepare(
      `INSERT INTO notification_settings (id, email_enabled, smtp_host, recipients)
       VALUES ('default', 1, 'smtp.example.com', 'ops@example.com')`,
    ).run();
    sendSmtpMock.mockResolvedValue(undefined);

    expect(() => queueNotification(db, event)).not.toThrow();
    await dispatchNotification(db, event);
    // Give any (wrongly scheduled) rejection handler a tick to run.
    await new Promise((resolve) => setImmediate(resolve));
    expect(auditRows(db)).toEqual([]);
  });

  it("survives the audit write itself failing", async () => {
    const db = memDb();
    db.prepare(
      `INSERT INTO notification_settings (id, email_enabled, smtp_host, recipients)
       VALUES ('default', 1, 'smtp.example.com', 'ops@example.com')`,
    ).run();
    sendSmtpMock.mockRejectedValue(new Error("smtp down"));
    const failing = db as unknown as { prepare: DatabaseSync["prepare"] };
    const originalPrepare = db.prepare.bind(db);
    failing.prepare = ((sql: string) => {
      if (sql.includes("INSERT INTO audit_events")) throw new Error("database is locked");
      return originalPrepare(sql);
    }) as DatabaseSync["prepare"];

    expect(() => queueNotification(db, event)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    // No unhandled rejection: the audit failure was swallowed too.
    await expect(dispatchNotification(db, event)).rejects.toThrow("smtp down");
  });
});
