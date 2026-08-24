export type DirectoryUser = {
  id: string;
  displayName: string;
  userPrincipalName: string;
  adSid: string;
  entraOid: string;
  jitEligible: number;
  disabled: number;
  rolesJson: string;
};

export type ElevationRequest = {
  id: string;
  userId: string;
  deviceId: string;
  filePath: string;
  fileHash: string;
  publisher: string;
  arguments: string;
  status: string;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  approvalExpiresAt: string | null;
  riskLevel: string;
  riskReasons: string;
};

export type JitGrant = {
  id: string;
  userId: string;
  deviceId: string;
  durationMinutes: number;
  reason: string;
  startsAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  status: string;
};

export type AuditEvent = {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  details: string;
};

export type Device = {
  id: string;
  hostname: string;
  joinType: string;
  secretEnc: string;
  enrolledAt: string;
  agentVersion: string;
};

export type DeviceSummary = {
  id: string;
  hostname: string;
  joinType: string;
  enrolledAt: string;
  pendingRequests: number;
  activeJit: number;
  lastEventAt: string | null;
  lastAction: string | null;
  agentVersion: string;
};

export type DirectorySettings = {
  tenantId: string;
  tenantName: string;
  setupClientId: string;
  daemonAppId: string;
  daemonObjectId: string;
  secretEnc: string;
  connectedAt: string | null;
  lastSyncAt: string | null;
  connectedBy: string;
};

export type OauthState = {
  state: string;
  verifier: string;
  kind: string;
  meta: string;
  createdAt: string;
};

export type DirectoryGroup = {
  id: string;
  name: string;
  directorySource: string;
  objectId: string;
  memberCount: number;
};
