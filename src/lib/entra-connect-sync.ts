import "server-only";
import { decryptSecret } from "./crypto-secret";
import {
  appendAudit,
  getDirectorySettings,
  getUserByUpn,
  replaceGroups,
  saveDirectorySettings,
  upsertUsers,
  type DirectorySettings,
} from "./db";
import type { DatabaseSync } from "node:sqlite";
import { clientCredentialToken, graphList, isRetryableSyncError, secretKey } from "./entra-graph";

/**
 * Entra directory sync + read of the stored connection status.
 *
 * Split out of entra-connect so that module stays under the 300-line cap. This
 * is a leaf module: it imports shared Graph/OAuth helpers and db accessors but
 * nothing that imports it back, so there is no circular dependency.
 */

export async function syncDirectoryWithRetry(db: DatabaseSync, settings: DirectorySettings) {
  let last = new Error("directory sync failed");
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await syncDirectory(db, settings);
    } catch (error) {
      last = error as Error;
      if (!isRetryableSyncError(last.message) && attempt > 0) throw last;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw last;
}

export async function syncDirectory(db: DatabaseSync, settings?: DirectorySettings) {
  const cfg = settings ?? getDirectorySettings(db);
  if (!cfg?.daemonAppId || !cfg.secretEnc) throw new Error("Entra ID is not connected");
  const secret = decryptSecret(cfg.secretEnc, secretKey());
  const token = await clientCredentialToken(cfg.tenantId, cfg.daemonAppId, secret);

  const graphUsers = await graphList<{
    id: string;
    displayName?: string;
    userPrincipalName?: string;
    onPremisesSecurityIdentifier?: string;
    accountEnabled?: boolean;
  }>(
    token,
    "/users?$select=id,displayName,userPrincipalName,onPremisesSecurityIdentifier,accountEnabled&$top=999",
  );
  const users = graphUsers
    .filter((user) => user.accountEnabled !== false && user.userPrincipalName)
    .map((user) => ({
      displayName: String(user.displayName || user.userPrincipalName),
      userPrincipalName: String(user.userPrincipalName),
      entraOid: String(user.id),
      adSid: user.onPremisesSecurityIdentifier || undefined,
    }));
  upsertUsers(db, users);

  const oidToLocal = new Map<string, string>();
  for (const user of users) {
    const local = getUserByUpn(db, user.userPrincipalName);
    if (local) oidToLocal.set(user.entraOid, local.id);
  }

  const graphGroups = await graphList<{
    id: string;
    displayName?: string;
    securityEnabled?: boolean;
  }>(token, "/groups?$select=id,displayName,securityEnabled&$top=999");
  const groups: Array<{ id: string; name: string; objectId: string; memberUserIds: string[] }> = [];
  for (const group of graphGroups) {
    if (group.securityEnabled === false) continue;
    let members: Array<{ id: string }> = [];
    try {
      members = await graphList<{ id: string }>(
        token,
        `/groups/${group.id}/transitiveMembers?$select=id&$top=999`,
      );
    } catch {
      members = await graphList<{ id: string }>(token, `/groups/${group.id}/members?$select=id&$top=999`);
    }
    groups.push({
      id: group.id,
      name: group.displayName || group.id,
      objectId: group.id,
      memberUserIds: members.map((m) => oidToLocal.get(m.id)).filter((id): id is string => Boolean(id)),
    });
  }
  replaceGroups(db, groups);
  const nextSettings = { ...cfg, lastSyncAt: new Date().toISOString() };
  saveDirectorySettings(db, nextSettings);
  appendAudit(db, "system", "entra.sync", cfg.tenantId, { users: users.length, groups: groups.length });
  return { users: users.length, groups: groups.length, lastSyncAt: nextSettings.lastSyncAt };
}

export function publicDirectoryStatus(db: DatabaseSync) {
  const cfg = getDirectorySettings(db);
  if (!cfg?.daemonAppId) {
    return { connected: false as const };
  }
  return {
    connected: true as const,
    tenantName: cfg.tenantName,
    tenantId: cfg.tenantId,
    setupClientId: cfg.setupClientId,
    lastSyncAt: cfg.lastSyncAt,
    connectedBy: cfg.connectedBy,
  };
}
