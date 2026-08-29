import { describe, expect, it } from "vitest";
import { accountKindOf, effectiveRoleFor, isHighPrivilegeGroup, isWellKnownAdminSid } from "./elevation";
import { presentUsers } from "./present";
import type { DirectoryUser } from "./db";

describe("elevation classification", () => {
  it("flags high-privilege groups by name heuristics", () => {
    expect(isHighPrivilegeGroup({ name: "Domain Admins" })).toBe(true);
    expect(isHighPrivilegeGroup({ name: "CONTOSO Domain Admins" })).toBe(true);
    expect(isHighPrivilegeGroup({ name: "Enterprise Admins" })).toBe(true);
    expect(isHighPrivilegeGroup({ name: "Server Administrators" })).toBe(true);
    expect(isHighPrivilegeGroup({ name: "Helpdesk" })).toBe(false);
    expect(isHighPrivilegeGroup({ name: "Finance" })).toBe(false);
  });

  it("recognizes well-known admin SIDs even when names are localized", () => {
    expect(isWellKnownAdminSid("S-1-5-32-544")).toBe(true); // Builtin Administrators
    expect(isWellKnownAdminSid("S-1-5-21-1000-512")).toBe(true); // Domain Admins
    expect(isWellKnownAdminSid("S-1-5-21-1000-519")).toBe(true); // Enterprise Admins
    expect(isWellKnownAdminSid("S-1-5-21-1000-513")).toBe(false); // Domain Users
    expect(isHighPrivilegeGroup({ name: "Admins du domaine", objectId: "S-1-5-21-1000-512" })).toBe(true);
    expect(isHighPrivilegeGroup({ name: "Finance", objectId: "11111111-2222-3333-4444-555555555555" })).toBe(
      false,
    );
  });

  it("derives effective role from actual memberships", () => {
    const memberships = [
      { name: "Helpdesk", objectId: "g1" },
      { name: "Domain Admins", objectId: "g2" },
    ];
    expect(effectiveRoleFor(memberships)).toBe("elevated-admin");
    expect(effectiveRoleFor([{ name: "Helpdesk" }])).toBe("standard");
    expect(effectiveRoleFor([])).toBe("standard");
  });
});

describe("MSOL service-account classification", () => {
  it("flags Entra Connect sync accounts by UPN shape without hiding them", () => {
    expect(accountKindOf("MSOL_ad8c1f0@contoso.onmicrosoft.com")).toBe("service");
    expect(accountKindOf("msol_$(contoso.com)@contoso.com")).toBe("service");
    expect(accountKindOf("sync@msol.contoso.com")).toBe("service");
    expect(accountKindOf("ada@contoso.test")).toBe("human");
    // 'MSOL' inside a word is not the sync-account convention.
    expect(accountKindOf("msolomon@contoso.test")).toBe("human");
  });

  it("keeps classified users in presentation output with badges data", () => {
    const users: DirectoryUser[] = [
      directoryUser({
        id: "u-admin",
        displayName: "Domain Admin",
        userPrincipalName: "admin@contoso.test",
      }),
      directoryUser({
        id: "u-sync",
        displayName: "Entra Sync",
        userPrincipalName: "MSOL_ad8c1f0@contoso.onmicrosoft.com",
      }),
    ];
    const presented = presentUsers(users, {
      membershipsByUser: new Map([["u-admin", [{ name: "Domain Admins", objectId: "g2" }]]]),
    });
    expect(presented).toHaveLength(2); // nobody silently excluded
    expect(presented[0]).toMatchObject({ effectiveRole: "elevated-admin", accountKind: "human" });
    expect(presented[1]).toMatchObject({ effectiveRole: "standard", accountKind: "service" });
  });

  it("defaults every user to standard when no membership map is provided", () => {
    const presented = presentUsers([
      directoryUser({ id: "u1", displayName: "Anyone", userPrincipalName: "anyone@contoso.test" }),
    ]);
    expect(presented[0]).toMatchObject({ effectiveRole: "standard", accountKind: "human" });
  });
});

function directoryUser(overrides: Partial<DirectoryUser> & Pick<DirectoryUser, "id" | "displayName" | "userPrincipalName">): DirectoryUser {
  return {
    adSid: "",
    entraOid: "",
    disabled: 0,
    rolesJson: "[]",
    ...overrides,
  };
}
