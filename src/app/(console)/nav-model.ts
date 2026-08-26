import { hasAnyPermission, type PermissionId } from "@/lib/permissions";

/**
 * Single source of truth for the console side-nav: grouped zones, per-item
 * permission gates, and icon names resolved by nav-icons.tsx.
 */

/** Stroke-icon identifiers rendered by nav-icons.tsx. */
export type NavIconName =
  | "dashboard"
  | "inbox"
  | "monitor"
  | "shield-check"
  | "users"
  | "clock"
  | "doc-list"
  | "gear";

export type NavItem = {
  label: string;
  href: string;
  icon: NavIconName;
  /** Item renders when the viewer holds ANY of these permissions. */
  anyOf: PermissionId[];
  /** Optional live counter rendered in the .nav-count badge slot. */
  count?: number;
};

export type NavGroup = {
  /** Uppercase zone label; null renders an ungrouped anchor row (no label). */
  label: string | null;
  /** Pin the group to the bottom of the rail (margin-top:auto). */
  bottom?: boolean;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { label: "Dashboard", href: "/dashboard", icon: "dashboard", anyOf: ["dashboard.view"] },
    ],
  },
  {
    label: "Operate",
    items: [
      { label: "Elevations", href: "/elevations", icon: "inbox", anyOf: ["requests.view", "jit.view"] },
      { label: "Devices", href: "/devices", icon: "monitor", anyOf: ["devices.view"] },
    ],
  },
  {
    label: "Govern",
    items: [
      { label: "Policies", href: "/allowlists", icon: "shield-check", anyOf: ["policies.view"] },
      {
        label: "JIT Access",
        href: "/directory",
        icon: "clock",
        anyOf: ["jit.view", "jit.grant", "directory.users.view", "directory.users.manage"],
      },
    ],
  },
  {
    label: "System",
    bottom: true,
    items: [
      { label: "Audit log", href: "/configuration/audit", icon: "doc-list", anyOf: ["audit.view"] },
      {
        label: "Admins & Roles",
        href: "/configuration/admins",
        icon: "users",
        anyOf: ["portal.users.manage", "portal.roles.manage"],
      },
      {
        label: "Settings",
        href: "/configuration",
        icon: "gear",
        anyOf: [
          "integrations.view",
          "integrations.manage",
          "notifications.view",
          "notifications.manage",
          "configuration.update",
        ],
      },
    ],
  },
];

/** Groups and items filtered down to what the session may see. */
export function visibleNavGroups(permissions: readonly string[] | undefined): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => hasAnyPermission(permissions, item.anyOf)),
  })).filter((group) => group.items.length > 0);
}

/**
 * Active nav href for a pathname: longest visible prefix wins, so
 * /configuration/audit highlights "Audit log" rather than "Settings".
 */
export function activeNavHref(path: string, items: readonly NavItem[]): string | null {
  let best: string | null = null;
  for (const item of items) {
    if (!path.startsWith(item.href)) continue;
    if (!best || item.href.length > best.length) best = item.href;
  }
  return best;
}
