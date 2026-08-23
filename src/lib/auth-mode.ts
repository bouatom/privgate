export type AuthMode = "local" | "entra";

export function authMode(env: Record<string, string | undefined> = process.env): AuthMode {
  const raw = (env.AUTH_MODE || "local").trim().toLowerCase();
  if (raw === "entra") return "entra";
  return "local";
}

export function localLoginEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return authMode(env) === "local";
}

/** Entra SSO on the login page only when a tenant and public client exist. */
export function entraSsoAvailable(
  directory?: { tenantId?: string | null; setupClientId?: string | null } | null,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const tenant = String(directory?.tenantId || env.AZURE_AD_TENANT_ID || "").trim();
  const clientId = String(directory?.setupClientId || env.AZURE_AD_CLIENT_ID || "").trim();
  return Boolean(tenant && clientId);
}

/** Password form stays available until Entra SSO can actually complete a sign-in. */
export function localLoginOffered(
  entraAvailable: boolean,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (localLoginEnabled(env)) return true;
  return !entraAvailable;
}
