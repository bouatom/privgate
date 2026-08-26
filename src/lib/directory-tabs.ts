import { hasAnyPermission, type PermissionId } from "./permissions";

export type DirectoryTab = "users" | "admins";

/** Same ids CONFIG_TABS used for Access; keeps per-tab visibility identical. */
const USERS_TAB_PERMS: PermissionId[] = ["directory.users.view", "directory.users.manage"];
const ADMINS_TAB_PERMS: PermissionId[] = ["portal.users.manage", "portal.roles.manage"];

export function canViewUsersTab(granted: readonly string[] | undefined): boolean {
  return hasAnyPermission(granted, USERS_TAB_PERMS);
}

export function canViewAdminsTab(granted: readonly string[] | undefined): boolean {
  return hasAnyPermission(granted, ADMINS_TAB_PERMS);
}

/**
 * Resolve the active Directory tab from a `?tab=` search param.
 * Unknown or forbidden requests fall back to the first visible tab:
 * "users" by default, "admins" when the actor lacks directory perms
 * but holds portal user/role management.
 */
export function resolveDirectoryTab(
  granted: readonly string[] | undefined,
  requested?: string,
): DirectoryTab {
  if (requested === "admins" && canViewAdminsTab(granted)) return "admins";
  if (requested === "users" && canViewUsersTab(granted)) return "users";
  return canViewUsersTab(granted) ? "users" : "admins";
}
