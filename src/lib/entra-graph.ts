import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { getDirectorySettings } from "./db";
import { deviceSecretKey } from "./secrets";
import type { DatabaseSync } from "node:sqlite";

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

const MULTI_TENANT_ALIASES = new Set(["common", "organizations", "consumers"]);

export function entraJwksUrl(tenant: string): string {
  return `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`;
}

/** Signature + audience (and issuer when the tenant is a directory id). */
export function entraIdTokenVerifyOptions(tenant: string, clientId: string): {
  audience: string;
  issuer?: string;
} {
  if (MULTI_TENANT_ALIASES.has(tenant.toLowerCase())) {
    return { audience: clientId };
  }
  return {
    audience: clientId,
    issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
  };
}

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
export function inflightMap() {
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

export async function graphFetch<T>(token: string, urlOrPath: string, init?: RequestInit): Promise<T> {
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

export async function graphList<T>(token: string, path: string): Promise<T[]> {
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

export async function clientCredentialToken(tenantId: string, clientId: string, secret: string) {
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

export function secretKey() {
  return deviceSecretKey();
}

export async function assertGlobalAdmin(token: string) {
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

export async function findApplication(token: string, displayName: string) {
  const filter = encodeURIComponent(`displayName eq '${displayName}'`);
  const apps = await graphList<{ id: string; appId: string }>(token, `/applications?$filter=${filter}&$top=5`);
  return apps[0];
}

export async function ensureServicePrincipal(token: string, appId: string) {
  const filter = encodeURIComponent(`appId eq '${appId}'`);
  const existing = await graphList<{ id: string }>(token, `/servicePrincipals?$filter=${filter}&$top=1`);
  if (existing[0]) return existing[0];
  return graphFetch<{ id: string }>(token, "/servicePrincipals", {
    method: "POST",
    body: JSON.stringify({ appId }),
  });
}

export function isRetryableSyncError(message: string) {
  return /Authorization_RequestDenied|Insufficient privileges|not been granted|being assigned/i.test(message);
}

