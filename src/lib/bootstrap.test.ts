import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { consumeBootstrap } from "./bootstrap";
import { getDb, resetDbForTests } from "./db";
import { countPortalUsers, createPortalUser, getPortalUserByEmail } from "./portal";
import { isMasterPermissions } from "./permissions";

const previousDb = process.env.PRIVGATE_DB;
const previousData = process.env.PRIVGATE_DATA_DIR;

afterEach(() => {
  if (previousDb === undefined) delete process.env.PRIVGATE_DB;
  else process.env.PRIVGATE_DB = previousDb;
  if (previousData === undefined) delete process.env.PRIVGATE_DATA_DIR;
  else process.env.PRIVGATE_DATA_DIR = previousData;
  resetDbForTests(":memory:");
});

describe("consumeBootstrap", () => {
  it("creates the first Master Admin and deletes the bootstrap file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "privgate-boot-"));
    const dbPath = path.join(dir, "privgate.db");
    process.env.PRIVGATE_DATA_DIR = dir;
    process.env.PRIVGATE_DB = dbPath;
    resetDbForTests(dbPath);
    expect(countPortalUsers(getDb())).toBe(0);

    fs.writeFileSync(
      path.join(dir, "bootstrap.json"),
      JSON.stringify({
        email: "ops@example.test",
        password: "InitialPass-1",
        displayName: "Ops",
      }),
    );
    consumeBootstrap(getDb(), { PRIVGATE_DATA_DIR: dir, PRIVGATE_DB: dbPath });

    expect(fs.existsSync(path.join(dir, "bootstrap.json"))).toBe(false);
    const user = getPortalUserByEmail(getDb(), "ops@example.test");
    expect(user?.displayName).toBe("Ops");
    expect(isMasterPermissions(user?.permissions)).toBe(true);
    expect(countPortalUsers(getDb())).toBe(1);
  });

  it("is a no-op when a portal user already exists", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "privgate-boot-"));
    const dbPath = path.join(dir, "privgate.db");
    process.env.PRIVGATE_DATA_DIR = dir;
    process.env.PRIVGATE_DB = dbPath;
    resetDbForTests(dbPath);
    consumeBootstrap(getDb(), { PRIVGATE_DATA_DIR: dir, PRIVGATE_DB: dbPath });
    fs.writeFileSync(
      path.join(dir, "bootstrap.json"),
      JSON.stringify({ email: "second@example.test", password: "InitialPass-1", displayName: "Second" }),
    );
    createPortalUser(getDb(), {
      displayName: "First",
      email: "first@example.test",
      kind: "local",
      password: "InitialPass-1",
      roleIds: ["role-master-admin"],
    });
    consumeBootstrap(getDb(), { PRIVGATE_DATA_DIR: dir, PRIVGATE_DB: dbPath });
    expect(fs.existsSync(path.join(dir, "bootstrap.json"))).toBe(false);
    expect(countPortalUsers(getDb())).toBe(1);
    expect(getPortalUserByEmail(getDb(), "second@example.test")).toBeUndefined();
  });
});
