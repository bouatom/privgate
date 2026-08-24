export const PERMISSIONS = [
  { id: "dashboard.view", group: "Overview", label: "View dashboard" },
  { id: "requests.view", group: "Elevation", label: "View elevation requests" },
  { id: "requests.approve", group: "Elevation", label: "Approve elevation requests" },
  { id: "requests.deny", group: "Elevation", label: "Deny elevation requests" },
  { id: "policies.view", group: "Allowlists", label: "View always-allow rules" },
  { id: "policies.manage", group: "Allowlists", label: "Create and remove always-allow rules" },
  { id: "jit.view", group: "JIT", label: "View JIT windows" },
  { id: "jit.grant", group: "JIT", label: "Open JIT admin windows" },
  { id: "jit.revoke", group: "JIT", label: "Force-revoke JIT windows" },
  { id: "directory.users.view", group: "Directory", label: "View directory users and groups" },
  { id: "directory.users.manage", group: "Directory", label: "Change JIT eligibility and disable directory users" },
  { id: "devices.view", group: "Devices", label: "View enrolled devices" },
  { id: "devices.enroll", group: "Devices", label: "Download Windows client installers" },
  { id: "devices.update", group: "Devices", label: "Push agent updates to devices" },
  { id: "integrations.view", group: "Configuration", label: "View Entra / AD integrations" },
  { id: "integrations.manage", group: "Configuration", label: "Connect, sync, and test directory integrations" },
  { id: "notifications.view", group: "Configuration", label: "View notification settings" },
  { id: "notifications.manage", group: "Configuration", label: "Change notification settings" },
  { id: "audit.view", group: "Configuration", label: "View the audit log" },
  { id: "portal.users.manage", group: "Portal access", label: "Create portal users and assign roles" },
  { id: "portal.roles.manage", group: "Portal access", label: "Create and edit roles" },
] as const;

export type PermissionId = (typeof PERMISSIONS)[number]["id"];

export const ALL_PERMISSIONS: PermissionId[] = PERMISSIONS.map((p) => p.id);

export type PredefinedRole = {
  id: string;
  name: string;
  description: string;
  permissions: PermissionId[];
};

export const PREDEFINED_ROLES: PredefinedRole[] = [
  {
    id: "role-master-admin",
    name: "Master Admin",
    description: "Full console access, including users, roles, and every elevation control.",
    permissions: [...ALL_PERMISSIONS],
  },
  {
    id: "role-approver",
    name: "Approver",
    description: "Review and decide pending elevation requests.",
    permissions: ["dashboard.view", "requests.view", "requests.approve", "requests.deny", "audit.view"],
  },
  {
    id: "role-policy-admin",
    name: "Policy Admin",
    description: "Create always-allow rules and download Windows client installers.",
    permissions: [
      "dashboard.view",
      "policies.view",
      "policies.manage",
      "devices.view",
      "devices.enroll",
      "devices.update",
      "directory.users.view",
    ],
  },
  {
    id: "role-jit-operator",
    name: "JIT Operator",
    description: "Open and revoke temporary local Administrators windows.",
    permissions: ["dashboard.view", "jit.view", "jit.grant", "jit.revoke", "directory.users.view", "devices.view"],
  },
  {
    id: "role-auditor",
    name: "Auditor",
    description: "Read-only view of requests, devices, and the audit log.",
    permissions: ["dashboard.view", "requests.view", "devices.view", "audit.view"],
  },
];

export function isPermissionId(value: string): value is PermissionId {
  return (ALL_PERMISSIONS as string[]).includes(value);
}

export function sanitizePermissions(raw: unknown): PermissionId[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(String).filter(isPermissionId))];
}

export function hasPermission(granted: readonly string[] | undefined, need: PermissionId | PermissionId[]): boolean {
  const have = new Set(granted || []);
  const required = Array.isArray(need) ? need : [need];
  return required.every((id) => have.has(id));
}

export function hasAnyPermission(granted: readonly string[] | undefined, need: PermissionId[]): boolean {
  const have = new Set(granted || []);
  return need.some((id) => have.has(id));
}

export const MASTER_PERMISSIONS: PermissionId[] = ["portal.users.manage", "portal.roles.manage"];

export function isMasterPermissions(granted: readonly string[] | undefined): boolean {
  return hasPermission(granted, MASTER_PERMISSIONS);
}

export const NAV_PERMISSION: Record<string, PermissionId> = {
  "/dashboard": "dashboard.view",
  "/requests": "requests.view",
  "/devices": "devices.view",
  "/allowlists": "policies.view",
  "/jit": "jit.view",
  "/users": "directory.users.view",
};

export const CONFIG_TABS: Array<{ label: string; href: string; anyOf: PermissionId[] }> = [
  { label: "Users & permissions", href: "/configuration/access", anyOf: ["portal.users.manage", "portal.roles.manage"] },
  { label: "Network", href: "/configuration/network", anyOf: ["portal.users.manage", "integrations.view", "integrations.manage", "devices.enroll"] },
  { label: "Integrations", href: "/configuration/integrations", anyOf: ["integrations.view", "integrations.manage"] },
  { label: "Notifications", href: "/configuration/notifications", anyOf: ["notifications.view", "notifications.manage"] },
  { label: "Audit", href: "/configuration/audit", anyOf: ["audit.view"] },
];

export function firstAllowedConfigHref(granted: readonly string[] | undefined): string {
  const tab = CONFIG_TABS.find((item) => hasAnyPermission(granted, item.anyOf));
  return tab?.href || "/dashboard";
}
