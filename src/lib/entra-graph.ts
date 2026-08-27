import "server-only";
import { getDirectorySettings } from "./db";
import { deviceSecretKey } from "./secrets";
import type { DatabaseSync } from "node:sqlite";

// Re-export the OAuth protocol helpers so existing importers of entra-graph
// (entra-connect, entra.ts) keep working unchanged.
export { SETUP_SCOPES, authorizeUrl, clientCredentialToken, entraIdTokenVerifyOptions, entraJwksUrl, exchangeCode, pkcePair, pollDeviceCode, startDeviceCode } from "./entra-oauth";

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

