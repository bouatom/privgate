import type { PermissionId } from "./permissions";

/**
 * Shared shapes for Server Components to pass into Client Components.
 * This file must stay browser-safe: no `node:` imports, no SQLite, no fs.
 */

export type AdminSession = {
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: PermissionId[];
};

export type PortalRole = {
  id: string;
  name: string;
  description: string;
  permissions: PermissionId[];
  system: boolean;
};

export type PortalUser = {
  id: string;
  displayName: string;
  email: string;
  kind: "local" | "sso";
  passwordSet: boolean;
  entraOid: string;
  disabled: boolean;
  createdAt: string;
  roleIds: string[];
  roleNames: string[];
  permissions: PermissionId[];
};

export type PresentedUser = {
  id: string;
  displayName: string;
  userPrincipalName: string;
  adSid: string;
  entraOid: string;
  roles: string[];
  /** Real elevation status derived from high-privilege group membership. */
  effectiveRole: "standard" | "elevated-admin";
  /** 'service' flags directory sync/service accounts (e.g. MSOL_ UPNs). */
  accountKind: "human" | "service";
};

export type PresentedAudit = {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  details: Record<string, unknown>;
};

export type NotificationSettings = {
  emailEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpFrom: string;
  recipients: string;
  passwordSet: boolean;
  webhookEnabled: boolean;
  webhookUrl: string;
  onPending: boolean;
  onApproved: boolean;
  onDenied: boolean;
  onJit: boolean;
  criticalOnly: boolean;
};

export type AdSettings = {
  configured: boolean;
  host: string;
  port: number;
  useTls: boolean;
  bindDn: string;
  passwordSet: boolean;
  baseDn: string;
  userFilter: string;
  lastTestedAt: string | null;
  lastSyncAt: string | null;
  lastError: string;
};

/** Device group shape the Devices client needs to manage update policies. */
export type DeviceGroupModel = {
  id: string;
  name: string;
  /** Higher number wins when a device belongs to multiple groups with policies. */
  priority: number;
  /** Group-level update policy mode: 'auto' | 'scheduled' | 'manual' | '' (inherit). */
  updateMode: string;
  /** Daily scheduled time 'HH:MM' when updateMode === 'scheduled'; '' otherwise. */
  updateSchedule: string;
  /** Device ids in this group. */
  deviceIds: string[];
};
