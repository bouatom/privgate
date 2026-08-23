import { describe, it, expect } from "vitest";
import { diffConfigs, auditConfigChange, auditSecretRotation } from "./audit-helpers";
import Database from "better-sqlite3";

describe("diffConfigs", () => {
  it("detects all changes", () => {
    const old = { host: "old-host", port: 636, enabled: true };
    const new_ = { host: "new-host", port: 389, enabled: true };
    const diff = diffConfigs(old, new_);
    expect(diff.host).toEqual({ old: "old-host", new: "new-host" });
    expect(diff.port).toEqual({ old: 636, new: 389 });
    expect(diff.enabled).toBeUndefined(); // no change
  });

  it("redacts password fields", () => {
    const old = { password: "secret123", host: "host1" };
    const new_ = { password: "secret456", host: "host2" };
    const diff = diffConfigs(old, new_);
    expect(diff.password?.old).toBe("[redacted]");
    expect(diff.password?.new).toBe("[redacted]");
    expect(diff.host?.old).toBe("host1");
  });

  it("redacts secret fields", () => {
    const old = { clientSecret: "old-secret", clientId: "id1" };
    const new_ = { clientSecret: "new-secret", clientId: "id2" };
    const diff = diffConfigs(old, new_);
    expect(diff.clientSecret?.old).toBe("[redacted]");
    expect(diff.clientSecret?.new).toBe("[redacted]");
    expect(diff.clientId?.old).toBe("id1");
  });

  it("handles undefined old config", () => {
    const new_ = { host: "host1", port: 636 };
    const diff = diffConfigs(undefined, new_);
    expect(diff.host).toEqual({ old: undefined, new: "host1" });
    expect(diff.port).toEqual({ old: undefined, new: 636 });
  });

  it("handles undefined new config", () => {
    const old = { host: "host1", port: 636 };
    const diff = diffConfigs(old, undefined);
    expect(diff.host).toEqual({ old: "host1", new: undefined });
    expect(diff.port).toEqual({ old: 636, new: undefined });
  });
});

describe("auditConfigChange", () => {
  it("logs configuration changes with diff", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT NOT NULL,
        details TEXT NOT NULL
      )
    `);

    const old = { host: "dc1.example.com", port: 636 };
    const new_ = { host: "dc2.example.com", port: 389 };
    auditConfigChange(db, "admin@example.com", "ad", "directory", old, new_);

    const rows = db.prepare("SELECT * FROM audit_events").all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe("admin@example.com");
    expect(rows[0].action).toBe("config.ad.update");
    expect(rows[0].target).toBe("directory");
    const details = JSON.parse(rows[0].details as string);
    expect(details.changes.host).toEqual({ old: "dc1.example.com", new: "dc2.example.com" });
    expect(details.changes.port).toEqual({ old: 636, new: 389 });
  });

  it("includes additional details", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT NOT NULL,
        details TEXT NOT NULL
      )
    `);

    auditConfigChange(
      db,
      "admin@example.com",
      "policy",
      "policy-1",
      { maxRetries: 3 },
      { maxRetries: 5 },
      { reason: "performance tuning" },
    );

    const rows = db.prepare("SELECT * FROM audit_events").all() as Record<string, unknown>[];
    const details = JSON.parse(rows[0].details as string);
    expect(details.reason).toBe("performance tuning");
  });
});

describe("auditSecretRotation", () => {
  it("logs secret rotation without storing the secret", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT NOT NULL,
        details TEXT NOT NULL
      )
    `);

    auditSecretRotation(db, "device-secret-key", "system");

    const rows = db.prepare("SELECT * FROM audit_events").all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("secret.rotate");
    expect(rows[0].target).toBe("device-secret-key");
    const details = JSON.parse(rows[0].details as string);
    expect(details.rotatedAt).toBeDefined();
  });

  it("includes rotation reason in details", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT NOT NULL,
        details TEXT NOT NULL
      )
    `);

    auditSecretRotation(db, "signing-key", "operator@example.com", { reason: "quarterly rotation" });

    const rows = db.prepare("SELECT * FROM audit_events").all() as Record<string, unknown>[];
    const details = JSON.parse(rows[0].details as string);
    expect(details.reason).toBe("quarterly rotation");
  });
});
