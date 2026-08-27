import { NextResponse } from "next/server";
import { randomBytes, randomUUID } from "node:crypto";
import { getDb, saveOauthState, getDirectorySettings } from "@/lib/db";
import { pkcePair } from "@/lib/entra";
import { requestOrigin } from "@/lib/origin";

export async function GET(req: Request) {
  const db = getDb();
  const directory = getDirectorySettings(db);
  const tenant = directory?.tenantId || process.env.AZURE_AD_TENANT_ID;
  const clientId = directory?.setupClientId || process.env.AZURE_AD_CLIENT_ID;
  const origin = requestOrigin(req);
  const redirect = process.env.AZURE_AD_REDIRECT_URI || `${origin}/api/auth/entra/callback`;
  if (!tenant || !clientId) {
    return NextResponse.json({ error: "Entra ID is not connected yet. Use Connect Entra on the Users page." }, { status: 501 });
  }

  const state = randomUUID();
  const nonce = randomBytes(16).toString("hex");
  const { verifier, challenge } = pkcePair();
  saveOauthState(db, state, verifier, "login", { clientId, tenant, redirectUri: redirect, nonce });

  const url = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("nonce", nonce);
  const res = NextResponse.redirect(url);
  res.cookies.set("privgate_oauth_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}
