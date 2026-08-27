import "server-only";
import { randomUUID } from "node:crypto";
import { encryptSecret } from "./crypto-secret";
import {
  appendAudit,
  deleteOauthState,
  getDirectorySettings,
  getOauthState,
  saveDirectorySettings,
  saveOauthState,
  takeOauthState,
  type DirectorySettings,
} from "./db";
import type { DatabaseSync } from "node:sqlite";
import { setupRedirectUris } from "./origin";
import { syncDirectory, syncDirectoryWithRetry } from "./entra-connect-sync";
import {
  APP_ROLES,
  DAEMON_DISPLAY_NAME,
  GRAPH_APP_ID,
  SETUP_DISPLAY_NAME,
  assertGlobalAdmin,
  authorizeUrl,
  ensureServicePrincipal,
  exchangeCode,
  findApplication,
  graphFetch,
  graphList,
  inflightMap,
  pkcePair,
  pollDeviceCode,
  secretKey,
  startDeviceCode,
  daemonApplicationBody,
  setupApplicationBody,
} from "./entra-graph";

// Re-export the sync/status helpers so existing importers of entra-connect
// (entra.ts) keep working unchanged.
export { syncDirectory, syncDirectoryWithRetry, publicDirectoryStatus } from "./entra-connect-sync";

export async function provisionFromAdminToken(
  db: DatabaseSync,
  adminToken: string,
  origin: string,
  actor: string,
) {
  await assertGlobalAdmin(adminToken);
  const existing = getDirectorySettings(db);
  if (existing?.daemonAppId && existing.secretEnc) {
    const synced = await syncDirectory(db, existing);
    return { reused: true as const, tenantName: existing.tenantName, tenantId: existing.tenantId, ...synced };
  }

  const me = await graphFetch<{
    id: string;
    displayName?: string;
    userPrincipalName?: string;
    mail?: string;
  }>(adminToken, "/me");
  const org = await graphFetch<{ value: Array<{ id: string; displayName?: string }> }>(adminToken, "/organization");
  const tenantId = org.value[0]?.id;
  if (!tenantId) throw new Error("could not read tenant");
  const tenantName = org.value[0]?.displayName || "";
  const redirectUris = setupRedirectUris(origin);

  let setupApp = await findApplication(adminToken, SETUP_DISPLAY_NAME);
  if (!setupApp) {
    setupApp = await graphFetch<{ id: string; appId: string }>(adminToken, "/applications", {
      method: "POST",
      body: JSON.stringify(setupApplicationBody(redirectUris)),
    });
  } else {
    await graphFetch(adminToken, `/applications/${setupApp.id}`, {
      method: "PATCH",
      body: JSON.stringify({ web: { redirectUris }, isFallbackPublicClient: true }),
    }).catch(() => undefined);
  }

  let daemon = await findApplication(adminToken, DAEMON_DISPLAY_NAME);
  if (!daemon) {
    daemon = await graphFetch<{ id: string; appId: string }>(adminToken, "/applications", {
      method: "POST",
      body: JSON.stringify(daemonApplicationBody(redirectUris)),
    });
  }

  const password = await graphFetch<{ secretText: string }>(adminToken, `/applications/${daemon.id}/addPassword`, {
    method: "POST",
    body: JSON.stringify({ passwordCredential: { displayName: "privgate-sync" } }),
  });

  const daemonSp = await ensureServicePrincipal(adminToken, daemon.appId);
  await ensureServicePrincipal(adminToken, setupApp.appId);

  const graphSpFilter = encodeURIComponent(`appId eq '${GRAPH_APP_ID}'`);
  const graphSp = await graphList<{ id: string }>(adminToken, `/servicePrincipals?$filter=${graphSpFilter}&$top=1`);
  const graphSpId = graphSp[0]?.id;
  if (!graphSpId) throw new Error("Microsoft Graph service principal missing");

  for (const appRoleId of Object.values(APP_ROLES)) {
    await graphFetch(adminToken, `/servicePrincipals/${graphSpId}/appRoleAssignedTo`, {
      method: "POST",
      body: JSON.stringify({
        principalId: daemonSp.id,
        resourceId: graphSpId,
        appRoleId,
      }),
    }).catch((err: Error) => {
      if (!/already exists|Permission being assigned already exists/i.test(err.message)) throw err;
    });
  }

  const settings: DirectorySettings = {
    tenantId,
    tenantName,
    setupClientId: setupApp.appId,
    daemonAppId: daemon.appId,
    daemonObjectId: daemon.id,
    secretEnc: encryptSecret(password.secretText, secretKey()),
    connectedAt: new Date().toISOString(),
    lastSyncAt: null,
    connectedBy: actor || me.userPrincipalName || me.mail || me.id,
  };
  saveDirectorySettings(db, settings);
  appendAudit(db, settings.connectedBy, "entra.connect", daemon.appId, {
    tenant: tenantName,
    tenantId,
    setupApp: setupApp.appId,
  });
  const synced = await syncDirectoryWithRetry(db, settings);
  return { reused: false as const, tenantName, tenantId, admin: me.userPrincipalName || me.displayName, ...synced };
}

export function beginPkceSetup(db: DatabaseSync, origin: string, clientId: string, tenant: string) {
  const state = randomUUID();
  const { verifier, challenge } = pkcePair();
  const redirectUri = `${origin}/api/setup/entra/callback`;
  saveOauthState(db, state, verifier, "pkce", { clientId, tenant, redirectUri });
  return {
    mode: "redirect" as const,
    url: authorizeUrl({ tenant, clientId, redirectUri, state, challenge }),
    state,
  };
}

export async function beginNativeDeviceSetup(db: DatabaseSync, clientId: string, tenant: string) {
  const started = await startDeviceCode({ tenant, clientId });
  const state = randomUUID();
  saveOauthState(db, state, started.deviceCode, "device", {
    clientId,
    tenant,
    interval: started.interval,
  });
  return {
    mode: "device" as const,
    state,
    userCode: started.userCode,
    verificationUri: started.verificationUri,
    verificationUriComplete: started.verificationUriComplete,
    interval: started.interval,
    expiresIn: started.expiresIn,
    message: started.message,
  };
}

export async function completePkceCallback(db: DatabaseSync, code: string, state: string, origin: string, actor: string) {
  const saved = takeOauthState(db, state);
  if (!saved || saved.kind !== "pkce") throw new Error("invalid or expired sign-in state");
  const meta = JSON.parse(saved.meta || "{}") as { clientId?: string; tenant?: string; redirectUri?: string };
  if (!meta.clientId || !meta.tenant || !meta.redirectUri) throw new Error("invalid sign-in state");
  const token = await exchangeCode({
    tenant: meta.tenant,
    clientId: meta.clientId,
    redirectUri: meta.redirectUri,
    code,
    verifier: saved.verifier,
    clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
  });
  return provisionFromAdminToken(db, token, origin, actor);
}

export async function pollNativeDeviceSetup(db: DatabaseSync, state: string, origin: string, actor: string) {
  const saved = getOauthState(db, state);
  if (!saved) return { status: "error" as const, error: "Sign-in expired. Start Connect Entra again." };
  const meta = JSON.parse(saved.meta || "{}") as { clientId?: string; tenant?: string };
  if (saved.kind === "az") {
    return { status: "pending" as const, kind: "az" as const };
  }
  if (!meta.clientId || !meta.tenant) {
    return { status: "error" as const, error: "invalid device login state" };
  }
  const key = `device:${state}`;
  const existing = inflightMap().get(key);
  if (existing) {
    return (await existing) as Awaited<ReturnType<typeof finishDevice>>;
  }
  const run = finishDevice(db, saved.verifier, meta.clientId, meta.tenant, state, origin, actor);
  inflightMap().set(key, run);
  try {
    return await run;
  } finally {
    inflightMap().delete(key);
  }
}

async function finishDevice(
  db: DatabaseSync,
  deviceCode: string,
  clientId: string,
  tenant: string,
  state: string,
  origin: string,
  actor: string,
) {
  const polled = await pollDeviceCode({ tenant, clientId, deviceCode });
  if (polled.status === "pending") return { status: "pending" as const };
  if (polled.status === "error") {
    deleteOauthState(db, state);
    return { status: "error" as const, error: polled.error };
  }
  deleteOauthState(db, state);
  const result = await provisionFromAdminToken(db, polled.token, origin, actor);
  return { status: "connected" as const, ...result };
}
