import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resetDbForTests } from "./db";
import { applyFactoryResetIfNeeded, deploymentInUse } from "./first-run";
import { countPortalUsers, createPortalUser, portalNeedsSetup } from "./portal";
import { isWizardCompleted } from "./setup-state";

const previousData = process.env.PRIVGATE_DATA_DIR;

afterEach(() => {
  if (previousData === undefined) delete process.env.PRIVGATE_DATA_DIR;
  else process.env.PRIVGATE_DATA_DIR = previousData;
  resetDbForTests(":memory:", { seedDemo: false });
});

function addMaster(db: ReturnType<typeof resetDbForTests>, email = "ops@example.test") {
  const created = createPortalUser(db, {
    displayName: "Ops",
    email,
    kind: "local",
    password: "TestPass-12",
    roleIds: ["role-master-admin"],
  });
  if ("error" in created) throw new Error(created.error);
  return created;
}

describe("first-run factory reset", () => {
  it("wipes leftover portal users from an unused console once", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    addMaster(db);
    db.prepare("UPDATE setup_state SET factory_reset = 0, wizard_completed = 1").run();
    applyFactoryResetIfNeeded(db);
    expect(portalNeedsSetup(db)).toBe(true);
    expect(isWizardCompleted(db)).toBe(false);

    addMaster(db);
    applyFactoryResetIfNeeded(db);
    expect(countPortalUsers(db)).toBe(1);
  });

  it("keeps portal users when a real device is enrolled", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    addMaster(db);
    db.prepare(
      "INSERT INTO devices (id, hostname, join_type, secret_enc, enrolled_at) VALUES (?, ?, ?, ?, ?)",
    ).run("dev-real-1", "DESKTOP-REAL", "hybrid", "x", new Date().toISOString());
    db.prepare("UPDATE setup_state SET factory_reset = 0").run();
    applyFactoryResetIfNeeded(db);
    expect(countPortalUsers(db)).toBe(1);
    expect(deploymentInUse(db)).toBe(true);
  });

  it("treats leftover lab devices as unused", () => {
    const db = resetDbForTests(":memory:");
    addMaster(db);
    db.prepare("UPDATE setup_state SET factory_reset = 0, wizard_completed = 1").run();
    applyFactoryResetIfNeeded(db);
    expect(portalNeedsSetup(db)).toBe(true);
    expect(isWizardCompleted(db)).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS c FROM devices").get() as { c: number }).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).toEqual({ c: 0 });
  });

  it("deletes leftover bootstrap.json on unused reset", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "privgate-first-run-"));
    process.env.PRIVGATE_DATA_DIR = dir;
    fs.writeFileSync(path.join(dir, "bootstrap.json"), JSON.stringify({ email: "old@example.test" }));
    const db = resetDbForTests(":memory:", { seedDemo: false });
    addMaster(db);
    db.prepare("UPDATE setup_state SET factory_reset = 0").run();
    applyFactoryResetIfNeeded(db);
    expect(fs.existsSync(path.join(dir, "bootstrap.json"))).toBe(false);
    expect(portalNeedsSetup(db)).toBe(true);
  });
});
