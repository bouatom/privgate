import "server-only";

export type { AdSettings, NotificationSettings } from "../models";
export type {
  AuditEvent,
  Device,
  DeviceSummary,
  DirectoryGroup,
  DirectorySettings,
  DirectoryUser,
  ElevationRequest,
  JitGrant,
  OauthState,
} from "./types";

export { dbPath, getDb, resetDbForTests } from "./connection";
export { appendAudit, listAudit, listAuditActions, listAuditCount, listAuditForDevice } from "./audit";
export {
  findUserBySid,
  getUser,
  getUserByUpn,
  groupIdsForUser,
  listUsers,
  rowUser,
  upsertUsers,
} from "./users";
export { deletePolicy, insertPolicy, listPolicies, updatePolicy } from "./policies";
export { decideRequest, getRequest, insertRequest, listRequests } from "./requests";
export { listUacPrompts, listUacPromptsForDevice, upsertUacPrompt } from "./uac-prompts";
export type { UacPrompt, UacPromptRow } from "./uac-prompts";
export { activeJit, createJit, expireDueGrants, getJit, grantIdentities, listJit, revokeJit } from "./jit";
export {
  consumeNonce,
  deviceDetail,
  enrollDevice,
  getDevice,
  getDeviceByHostname,
  listDeviceSummaries,
  listDevices,
  registerOrReuseDevice,
  setDeviceAgentVersion,
  setDeviceLastIp,
  setDeviceUpdateRequestedAt,
  touchDeviceLastSeen,
} from "./devices";
export {
  deleteOauthState,
  getDirectorySettings,
  getOauthState,
  listGroupMemberships,
  listGroups,
  replaceGroups,
  saveDirectorySettings,
  saveOauthState,
  takeOauthState,
} from "./directory";
export { getNotificationSecrets, getNotificationSettings, saveNotificationSettings } from "./notifications";
export { getElevationSettings, saveElevationSettings } from "./elevation-settings";
export type { ElevationSettings } from "./elevation-settings";
export { getAdSettings, saveAdSettings } from "./ad";
export { fixturesAllowed, purgeDemoFixtures, seedDemo } from "./seed";
