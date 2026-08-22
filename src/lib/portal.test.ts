import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { migratePortal, listRoles, listPortalUsers, createRole, createPortalUser, updatePortalUser, getPortalPasswordHash, countMasterAdmins } from "./portal";
import { hashPassword, verifyPassword } from "./passwords";
import { hasPermission, isMasterPermissions, ALL_PERMISSIONS, PREDEFINED_ROLES } from "./permissions";

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  migratePortal(db);
  return db;
}

afterEach(() => {
  // no persistent state; each test creates its own in-memory DB
});

describe("migratePortal + seed", () => {
  it("seeds Ada as Master Admin on empty DB", () => {
    const db = freshDb();
    const users = listPortalUsers(db);
    expect(users.length).toBe(1);
    const ada = users[0]!;
    expect(ada.email).toBe("ada@contoso.test");
    expect(ada.kind).toBe("local");
    expect(ada.disabled).toBe(false);
    expect(isMasterPermissions(ada.permissions)).toBe(true);
  });

  it("does not re-seed if portal_users already has rows", () => {
    const db = freshDb();
    migratePortal(db); // second call
    const users = listPortalUsers(db);
    expect(users.length).toBe(1);
  });

  it("upserts all predefined roles on each migration", () => {
    const db = freshDb();
    const roles = listRoles(db);
    const predefinedIds = PREDEFINED_ROLES.map((r) => r.id);
    for (const id of predefinedIds) {
      expect(roles.some((r) => r.id === id)).toBe(true);
    }
  });

  it("predefined roles have system=true and cannot be edited", () => {
    const db = freshDb();
    const roles = listRoles(db).filter((r) => r.system);
    expect(roles.length).toBe(PREDEFINED_ROLES.length);
  });
});

describe("createRole", () => {
  it("creates a custom role with valid permissions", () => {
    const db = freshDb();
    const result = createRole(db, { name: "Helpdesk", description: "level-1", permissions: ["requests.view", "audit.view"] });
    expect("error" in result).toBe(false);
    if ("error" in result) throw new Error(result.error);
    expect(result.name).toBe("Helpdesk");
    expect(result.system).toBe(false);
    expect(result.permissions).toContain("requests.view");
  });

  it("rejects empty name", () => {
    const db = freshDb();
    const result = createRole(db, { name: "  ", permissions: ["audit.view"] });
    expect("error" in result).toBe(true);
  });

  it("rejects empty permissions", () => {
    const db = freshDb();
    const result = createRole(db, { name: "Empty", permissions: [] });
    expect("error" in result).toBe(true);
  });

  it("strips unknown permission IDs", () => {
    const db = freshDb();
    const result = createRole(db, { name: "Test", permissions: ["audit.view", "not.a.real.perm" as never] });
    if ("error" in result) throw new Error(result.error);
    expect(result.permissions).not.toContain("not.a.real.perm");
    expect(result.permissions).toContain("audit.view");
  });
});

describe("createPortalUser", () => {
  it("creates a local user with hashed password", () => {
    const db = freshDb();
    const role = listRoles(db).find((r) => r.id === "role-approver")!;
    const result = createPortalUser(db, {
      displayName: "Sam Approver",
      email: "sam@contoso.test",
      kind: "local",
      password: "S3cur3P@ss",
      roleIds: [role.id],
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.email).toBe("sam@contoso.test");
    expect(result.passwordSet).toBe(true);
    const hash = getPortalPasswordHash(db, result.id);
    expect(verifyPassword("S3cur3P@ss", hash)).toBe(true);
    expect(verifyPassword("wrong", hash)).toBe(false);
  });

  it("creates an SSO user without password", () => {
    const db = freshDb();
    const result = createPortalUser(db, {
      displayName: "SSO User",
      email: "sso@contoso.test",
      kind: "sso",
      roleIds: ["role-approver"],
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.kind).toBe("sso");
    expect(result.passwordSet).toBe(false);
  });

  it("rejects SSO user with a password", () => {
    const db = freshDb();
    const result = createPortalUser(db, {
      displayName: "SSO With Pass",
      email: "bad@contoso.test",
      kind: "sso",
      password: "secret",
      roleIds: ["role-approver"],
    });
    expect("error" in result).toBe(true);
  });

  it("rejects duplicate email", () => {
    const db = freshDb();
    createPortalUser(db, { displayName: "First", email: "dup@contoso.test", kind: "local", roleIds: ["role-approver"] });
    const result = createPortalUser(db, { displayName: "Second", email: "dup@contoso.test", kind: "local", roleIds: ["role-approver"] });
    expect("error" in result).toBe(true);
  });

  it("rejects user with no roles", () => {
    const db = freshDb();
    const result = createPortalUser(db, { displayName: "No Role", email: "norole@contoso.test", kind: "local", roleIds: [] });
    expect("error" in result).toBe(true);
  });
});

describe("last-master protection", () => {
  it("cannot disable the only Master Admin", () => {
    const db = freshDb();
    const users = listPortalUsers(db);
    const ada = users.find((u) => u.email === "ada@contoso.test")!;
    const result = updatePortalUser(db, ada.id, { disabled: true });
    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error).toMatch(/master admin/i);
  });

  it("cannot strip Master Admin role from the only master", () => {
    const db = freshDb();
    const users = listPortalUsers(db);
    const ada = users.find((u) => u.email === "ada@contoso.test")!;
    // Assign Approver only (no master perms)
    const result = updatePortalUser(db, ada.id, { roleIds: ["role-approver"] });
    expect("error" in result).toBe(true);
  });

  it("allows disable when a second Master Admin exists", () => {
    const db = freshDb();
    createPortalUser(db, {
      displayName: "Second Master",
      email: "master2@contoso.test",
      kind: "local",
      roleIds: ["role-master-admin"],
    });
    const ada = listPortalUsers(db).find((u) => u.email === "ada@contoso.test")!;
    const result = updatePortalUser(db, ada.id, { disabled: true });
    expect("error" in result).toBe(false);
  });
});

describe("permissions helpers", () => {
  it("hasPermission returns true for granted permissions", () => {
    expect(hasPermission(["audit.view", "requests.view"], "audit.view")).toBe(true);
    expect(hasPermission(["audit.view"], "requests.view")).toBe(false);
  });

  it("hasPermission accepts array of required permissions (AND logic)", () => {
    expect(hasPermission(["audit.view", "requests.view"], ["audit.view", "requests.view"])).toBe(true);
    expect(hasPermission(["audit.view"], ["audit.view", "requests.view"])).toBe(false);
  });

  it("isMasterPermissions requires both portal manage perms", () => {
    expect(isMasterPermissions(ALL_PERMISSIONS)).toBe(true);
    expect(isMasterPermissions(["portal.users.manage"])).toBe(false);
    expect(isMasterPermissions([])).toBe(false);
  });
});

describe("password hashing", () => {
  it("verifies correct password", () => {
    const hash = hashPassword("Hunter2!");
    expect(verifyPassword("Hunter2!", hash)).toBe(true);
  });

  it("rejects wrong password", () => {
    const hash = hashPassword("Hunter2!");
    expect(verifyPassword("notcorrect", hash)).toBe(false);
  });

  it("rejects malformed hash", () => {
    expect(verifyPassword("anything", "not-a-valid-hash")).toBe(false);
  });
});

describe("Approver cannot manage portal users (API-level permission check)", () => {
  it("Approver has no portal management permissions", () => {
    const db = freshDb();
    const result = createPortalUser(db, {
      displayName: "App Rova",
      email: "approver@contoso.test",
      kind: "local",
      roleIds: ["role-approver"],
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.permissions).not.toContain("portal.users.manage");
    expect(result.permissions).not.toContain("portal.roles.manage");
    expect(result.permissions).toContain("requests.approve");
  });
});

describe("countMasterAdmins", () => {
  it("returns 1 after seed", () => {
    const db = freshDb();
    expect(countMasterAdmins(db)).toBe(1);
  });

  it("returns 2 after adding a second master", () => {
    const db = freshDb();
    createPortalUser(db, {
      displayName: "Second",
      email: "second@contoso.test",
      kind: "local",
      roleIds: ["role-master-admin"],
    });
    expect(countMasterAdmins(db)).toBe(2);
  });
});
