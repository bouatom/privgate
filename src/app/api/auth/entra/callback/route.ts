import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decodeJwt } from "jose";
import { getDb, takeOauthState } from "@/lib/db";
import { issueSession, sessionCookie } from "@/lib/auth";
import { getPortalUserByEmail } from "@/lib/portal";
import { requestOrigin } from "@/lib/origin";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = requestOrigin(req);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const cookieState = jar.get("privgate_oauth_state")?.value;
  if (!code || !state || state !== cookieState) {
    return NextResponse.json({ error: "invalid oauth state" }, { status: 400 });
  }

  const db = getDb();
  const saved = takeOauthState(db, state);
  let meta: { tenant?: string; clientId?: string; redirectUri?: string } = {};
  if (saved) {
    try {
      meta = JSON.parse(saved.meta || "{}") as typeof meta;
    } catch {
      return NextResponse.json({ error: "invalid oauth state" }, { status: 400 });
    }
  }
  const tenant = (saved ? meta.tenant : process.env.AZURE_AD_TENANT_ID) as string | undefined;
  const clientId = (saved ? meta.clientId : process.env.AZURE_AD_CLIENT_ID) as string | undefined;
  const redirect = (saved ? meta.redirectUri : undefined) as string | undefined;
  const redirectUri = redirect || process.env.AZURE_AD_REDIRECT_URI || `${origin}/api/auth/entra/callback`;
  const secret = process.env.AZURE_AD_CLIENT_SECRET;
  if (!tenant || !clientId) {
    return NextResponse.json({ error: "Entra ID is not configured" }, { status: 501 });
  }

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    scope: "openid profile email",
  });
  if (saved?.verifier) body.set("code_verifier", saved.verifier);
  if (secret) body.set("client_secret", secret);

  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenRes.ok) {
    return NextResponse.json({ error: "entra token exchange failed" }, { status: 401 });
  }
  const tokens = (await tokenRes.json()) as { id_token?: string };
  if (!tokens.id_token) return NextResponse.json({ error: "no id_token" }, { status: 401 });
  const claims = decodeJwt(tokens.id_token);
  const email = String(claims.preferred_username || claims.email || "");
  const oid = String(claims.oid || "");
  const portal = email ? getPortalUserByEmail(db, email) : undefined;
  if (!portal || portal.disabled || !portal.permissions.length) {
    return NextResponse.json({ error: "not an admin" }, { status: 403 });
  }
  if (portal.kind === "local" && portal.passwordSet) {
    return NextResponse.json({ error: "not an admin" }, { status: 403 });
  }
  if (oid && portal.entraOid && portal.entraOid !== oid) {
    return NextResponse.json({ error: "not an admin" }, { status: 403 });
  }
  const token = await issueSession({
    id: portal.id,
    email: portal.email,
    name: String(claims.name || portal.displayName),
  });
  const res = NextResponse.redirect(new URL("/dashboard", origin));
  res.cookies.set(sessionCookie(token));
  res.cookies.set("privgate_oauth_state", "", { path: "/", maxAge: 0 });
  return res;
}
