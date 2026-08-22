import { createHash, randomBytes, randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret } from "./crypto-secret";
import {
  appendAudit,
  deleteOauthState,
  getDirectorySettings,
  getOauthState,
  getUserByUpn,
  replaceGroups,
  saveDirectorySettings,
  saveOauthState,
  takeOauthState,
  upsertUsers,
  type DirectorySettings,
} from "./db";
import { deviceSecretKey } from "./secrets";
import type { DatabaseSync } from "node:sqlite";
import { setupRedirectUris } from "./origin";

const GRAPH = "https://graph.microsoft.com/v1.0";
export const GRAPH_APP_ID = "00000003-0000-0000-c000-000000000000";
export const GLOBAL_ADMIN_TEMPLATE = "62e90394-69f5-4237-9190-012177145e10";

export const APP_ROLES = {
  userReadAll: "df021288-bdef-4463-88db-98f22de89214",
  groupReadAll: "5b567255-7703-4780-807c-7be8301ae99b",
  directoryReadAll: "7ab1d382-f21e-4acd-a863-ba3e13f7da61",
};

export const DELEGATED = {
  applicationReadWriteAll: "bdfbf15f-ee85-4955-8675-146e8e5296b5",
  appRoleAssignmentReadWriteAll: "84bccea3-f856-4a8a-967b-dbe0a3d53a64",
  directoryReadAll: "06da0dbc-49e2-44d2-8312-53f166ab848a",
  userRead: "e1fe6dd8-ba31-4d61-89e7-88639da4683d",
};

export const SETUP_DISPLAY_NAME = "PrivGate Setup";
export const DAEMON_DISPLAY_NAME = "PrivGate Directory Sync";

export const SETUP_SCOPES = [
  "offline_access",
  "openid",
  "profile",
  "https://graph.microsoft.com/Application.ReadWrite.All",
  "https://graph.microsoft.com/AppRoleAssignment.ReadWrite.All",
  "https://graph.microsoft.com/Directory.Read.All",
  "https://graph.microsoft.com/User.Read",
].join(" ");

type GraphError = { error?: { message?: string; code?: string } };

const inflight = globalThis as unknown as { __privgateEntraInflight?: Map<string, Promise<unknown>> };
function inflightMap() {
  inflight.__privgateEntraInflight ??= new Map();
  return inflight.__privgateEntraInflight;
}

export function bootstrapClientId(override?: string): string | undefined {
  return (
    override?.trim() ||
    process.env.PRIVGATE_BOOTSTRAP_CLIENT_ID?.trim() ||
    process.env.AZURE_AD_CLIENT_ID?.trim() ||
    undefined
  );
}

export function setupTenant(db: DatabaseSync): string {
  return getDirectorySettings(db)?.tenantId || process.env.AZURE_AD_TENANT_ID?.trim() || "organizations";
}

export function resolvePublicClientId(db: DatabaseSync, override?: string): string | undefined {
  return getDirectorySettings(db)?.setupClientId || bootstrapClientId(override);
}

export function setupApplicationBody(redirectUris: string[]) {
  return {
    displayName: SETUP_DISPLAY_NAME,
    signInAudience: "AzureADMyOrg",
    isFallbackPublicClient: true,
    web: { redirectUris },
    requiredResourceAccess: [
      {
        resourceAppId: GRAPH_APP_ID,
        resourceAccess: [
          { id: DELEGATED.applicationReadWriteAll, type: "Scope" },
          { id: DELEGATED.appRoleAssignmentReadWriteAll, type: "Scope" },
          { id: DELEGATED.directoryReadAll, type: "Scope" },
          { id: DELEGATED.userRead, type: "Scope" },
        ],
      },
    ],
  };
}

export function daemonApplicationBody(redirectUris: string[]) {
  return {
    displayName: DAEMON_DISPLAY_NAME,
    signInAudience: "AzureADMyOrg",
    web: { redirectUris },
    requiredResourceAccess: [
      {
        resourceAppId: GRAPH_APP_ID,
        resourceAccess: [
          { id: APP_ROLES.userReadAll, type: "Role" },
          { id: APP_ROLES.groupReadAll, type: "Role" },
          { id: APP_ROLES.directoryReadAll, type: "Role" },
        ],
      },
    ],
  };
}

async function graphFetch<T>(token: string, urlOrPath: string, init?: RequestInit): Promise<T> {
  const url = urlOrPath.startsWith("https://") ? urlOrPath : `${GRAPH}${urlOrPath}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as T & GraphError) : ({} as T & GraphError);
  if (!res.ok) {
    throw new Error(body.error?.message || `Graph ${res.status} ${urlOrPath}`);
  }
  return body;
}

async function graphList<T>(token: string, path: string): Promise<T[]> {
  const items: T[] = [];
  let next: string | undefined = path;
  while (next) {
    const page: { value?: T[]; "@odata.nextLink"?: string } = await graphFetch(token, next);
    items.push(...(page.value ?? []));
    next = page["@odata.nextLink"];
  }
  return items;
}

export function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizeUrl(args: {
  tenant: string;
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}) {
  const url = new URL(`https://login.microsoftonline.com/${args.tenant}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", SETUP_SCOPES);
  url.searchParams.set("state", args.state);
  url.searchParams.set("code_challenge", args.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account consent");
  return url.toString();
}

export async function exchangeCode(args: {
  tenant: string;
  clientId: string;
  redirectUri: string;
  code: string;
  verifier: string;
  clientSecret?: string;
}) {
  const body = new URLSearchParams({
    client_id: args.clientId,
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    code_verifier: args.verifier,
    scope: SETUP_SCOPES,
  });
  if (args.clientSecret) body.set("client_secret", args.clientSecret);
  const res = await fetch(`https://login.microsoftonline.com/${args.tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string };
  if (!json.access_token) throw new Error(json.error_description || "token exchange failed");
  return json.access_token;
}

export async function startDeviceCode(args: { tenant: string; clientId: string }) {
  const res = await fetch(`https://login.microsoftonline.com/${args.tenant}/oauth2/v2.0/devicecode`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: args.clientId,
      scope: SETUP_SCOPES,
    }),
  });
  const json = (await res.json()) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    verification_uri_complete?: string;
    expires_in?: number;
    interval?: number;
    error_description?: string;
    message?: string;
  };
  if (!json.device_code || !json.user_code) {
    throw new Error(json.error_description || "Could not start Microsoft device login");
  }
  return {
    deviceCode: json.device_code,
    userCode: json.user_code,
    verificationUri: json.verification_uri || "https://microsoft.com/devicelogin",
    verificationUriComplete: json.verification_uri_complete,
    expiresIn: json.expires_in || 900,
    interval: json.interval || 5,
    message: json.message,
  };
}

export async function pollDeviceCode(args: { tenant: string; clientId: string; deviceCode: string }) {
  const res = await fetch(`https://login.microsoftonline.com/${args.tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: args.clientId,
      device_code: args.deviceCode,
    }),
  });
  const json = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (json.access_token) return { status: "ready" as const, token: json.access_token };
  if (json.error === "authorization_pending" || json.error === "slow_down") {
    return { status: "pending" as const };
  }
  return { status: "error" as const, error: json.error_description || json.error || "device login failed" };
}

async function clientCredentialToken(tenantId: string, clientId: string, secret: string) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: secret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string };
  if (!json.access_token) throw new Error(json.error_description || "app token failed");
  return json.access_token;
}

function secretKey() {
  return deviceSecretKey();
}

async function assertGlobalAdmin(token: string) {
  const memberships = await graphList<{
    displayName?: string;
    roleTemplateId?: string;
    "@odata.type"?: string;
  }>(token, "/me/memberOf");
  const ok = memberships.some(
    (row) =>
      row.roleTemplateId === GLOBAL_ADMIN_TEMPLATE ||
      row.displayName === "Global Administrator" ||
      row.displayName === "Company Administrator",
  );
  if (!ok) {
    throw new Error("Sign in with a Global Administrator. If the role is PIM-eligible, activate it first.");
  }
}

async function findApplication(token: string, displayName: string) {
  const filter = encodeURIComponent(`displayName eq '${displayName}'`);
  const apps = await graphList<{ id: string; appId: string }>(token, `/applications?$filter=${filter}&$top=5`);
  return apps[0];
}

async function ensureServicePrincipal(token: string, appId: string) {
  const filter = encodeURIComponent(`appId eq '${appId}'`);
  const existing = await graphList<{ id: string }>(token, `/servicePrincipals?$filter=${filter}&$top=1`);
  if (existing[0]) return existing[0];
  return graphFetch<{ id: string }>(token, "/servicePrincipals", {
    method: "POST",
    body: JSON.stringify({ appId }),
  });
}

function isRetryableSyncError(message: string) {
  return /Authorization_RequestDenied|Insufficient privileges|not been granted|being assigned/i.test(message);
}

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

async function syncDirectoryWithRetry(db: DatabaseSync, settings: DirectorySettings) {
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
      adSid: String(user.onPremisesSecurityIdentifier || ""),
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
