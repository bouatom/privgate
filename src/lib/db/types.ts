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
  /** Directory user id for personal grants; '' for group grants. */
  userId: string;
  /** Group id for group-based grants; '' for personal grants. */
  groupId: string;
  deviceId: string;
  durationMinutes: number;
  reason: string;
  startsAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  status: string;
  /** Snapshot of group member user ids taken at grant time ([] for personal). */
  memberIds: string[];
  /** 'group' when groupId is set, else 'user'. */
  kind: "user" | "group";
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
  /** ISO timestamp of the last socket connect/close; '' when never seen. */
  lastSeenAt: string;
  /** ISO timestamp of a queued update request; '' when none is pending. */
  updateRequestedAt: string;
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
  lastSeenAt: string | null;
  updateRequestedAt: string | null;
  /** True while the device socket is live AND its GUI heartbeat is fresh. */
  uiAlive: boolean | null;
  /** ISO timestamp of the newest GUI heartbeat; null when none ever arrived. */
  uiLastSeenAt: string | null;
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
  /** AD distinguished name ('' for Entra-sourced groups). */
  dn: string;
  memberCount: number;
};
