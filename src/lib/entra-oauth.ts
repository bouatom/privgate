import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * Pure Microsoft Entra OAuth 2.0 / OpenID Connect protocol helpers.
 *
 * Kept in their own module (entra-graph re-exports them) so the Graph
 * directory plumbing and the OAuth wire protocol stay as separate domains, and
 * every module stays under the 300-line cap.
 */

export const SETUP_SCOPES = [
  "offline_access",
  "openid",
  "profile",
  "https://graph.microsoft.com/Application.ReadWrite.All",
  "https://graph.microsoft.com/AppRoleAssignment.ReadWrite.All",
  "https://graph.microsoft.com/Directory.Read.All",
  "https://graph.microsoft.com/User.Read",
].join(" ");

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
