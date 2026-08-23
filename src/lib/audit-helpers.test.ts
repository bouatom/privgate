import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { diffConfigs, auditConfigChange, auditSecretRotation } from "./audit-helpers";

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
    )
  `);
  return db;
}

describe("diffConfigs", () => {
  it("detects all changes", () => {
    const old = { host: "old-host", port: 636, enabled: true };
    const next = { host: "new-host", port: 389, enabled: true };
    const diff = diffConfigs(old, next);
    expect(diff.host).toEqual({ old: "old-host", new: "new-host" });
    expect(diff.port).toEqual({ old: 636, new: 389 });
    expect(diff.enabled).toBeUndefined();
  });

  it("redacts password fields", () => {
    const old = { password: "secret123", host: "host1" };
    const next = { password: "secret456", host: "host2" };
    const diff = diffConfigs(old, next);
    expect(diff.password?.old).toBe("[redacted]");
    expect(diff.password?.new).toBe("[redacted]");
    expect(diff.host?.old).toBe("host1");
  });

  it("redacts secret fields", () => {
    const old = { clientSecret: "old-secret", clientId: "id1" };
    const next = { clientSecret: "new-secret", clientId: "id2" };
    const diff = diffConfigs(old, next);
    expect(diff.clientSecret?.old).toBe("[redacted]");
    expect(diff.clientSecret?.new).toBe("[redacted]");
    expect(diff.clientId?.old).toBe("id1");
  });

  it("handles undefined old config", () => {
    const next = { host: "host1", port: 636 };
    const diff = diffConfigs(undefined, next);
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
  it("logs configuration changes with a diff", () => {
    const db = memDb();
    auditConfigChange(
      db,
      "admin@example.com",
      "ad",
      "directory",
      { host: "dc1.example.com", port: 636 },
      { host: "dc2.example.com", port: 389 },
    );
    const rows = db.prepare("SELECT * FROM audit_events").all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe("admin@example.com");
    expect(rows[0]?.action).toBe("config.ad.update");
    expect(rows[0]?.target).toBe("directory");
    const details = JSON.parse(String(rows[0]?.details));
    expect(details.changes.host).toEqual({ old: "dc1.example.com", new: "dc2.example.com" });
    expect(details.changes.port).toEqual({ old: 636, new: 389 });
  });

  it("includes additional details", () => {
    const db = memDb();
    auditConfigChange(db, "admin@example.com", "policy", "policy-1", { maxRetries: 3 }, { maxRetries: 5 }, {
      reason: "performance tuning",
    });
    const rows = db.prepare("SELECT * FROM audit_events").all() as Record<string, unknown>[];
    const details = JSON.parse(String(rows[0]?.details));
    expect(details.reason).toBe("performance tuning");
  });
});

describe("auditSecretRotation", () => {
  it("logs secret rotation without storing the secret", () => {
    const db = memDb();
    auditSecretRotation(db, "device-secret-key", "system");
    const rows = db.prepare("SELECT * FROM audit_events").all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("secret.rotate");
    expect(rows[0]?.target).toBe("device-secret-key");
    const details = JSON.parse(String(rows[0]?.details));
    expect(details.rotatedAt).toBeDefined();
  });

  it("includes rotation reason in details", () => {
    const db = memDb();
    auditSecretRotation(db, "signing-key", "operator@example.com", { reason: "quarterly rotation" });
    const rows = db.prepare("SELECT * FROM audit_events").all() as Record<string, unknown>[];
    const details = JSON.parse(String(rows[0]?.details));
    expect(details.reason).toBe("quarterly rotation");
  });
});
