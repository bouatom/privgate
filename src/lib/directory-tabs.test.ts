import { describe, expect, it } from "vitest";
import { resolveDirectoryTab } from "./directory-tabs";

const all = [
  "directory.users.view",
  "directory.users.manage",
  "portal.users.manage",
  "portal.roles.manage",
];
const usersOnly = ["directory.users.view"];
const adminsOnly = ["portal.roles.manage"];
const none: string[] = [];

describe("resolveDirectoryTab", () => {
  it("defaults to users for a full-permission actor", () => {
    expect(resolveDirectoryTab(all)).toBe("users");
  });

  it("honors an explicit ?tab=admins request", () => {
    expect(resolveDirectoryTab(all, "admins")).toBe("admins");
  });

  it("honors an explicit ?tab=users request", () => {
    expect(resolveDirectoryTab(all, "users")).toBe("users");
  });

  it("falls back to admins when directory view is missing", () => {
    expect(resolveDirectoryTab(adminsOnly)).toBe("admins");
    expect(resolveDirectoryTab(adminsOnly, "users")).toBe("admins");
  });

  it("ignores a forbidden admins request and stays on users", () => {
    expect(resolveDirectoryTab(usersOnly, "admins")).toBe("users");
  });

  it("treats unknown tab values as no preference", () => {
    expect(resolveDirectoryTab(all, "bogus")).toBe("users");
    expect(resolveDirectoryTab(adminsOnly, "bogus")).toBe("admins");
  });

  it("resolves to admins even with zero permissions (page gates separately)", () => {
    expect(resolveDirectoryTab(none)).toBe("admins");
  });
});
