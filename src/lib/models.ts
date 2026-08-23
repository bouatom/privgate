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
  jitEligible: boolean;
  disabled: boolean;
  roles: string[];
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
  lastError: string;
};
