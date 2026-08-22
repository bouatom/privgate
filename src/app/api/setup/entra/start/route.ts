import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getDb, saveOauthState } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";
import { requestOrigin } from "@/lib/origin";
import { azBinary, azGraphToken, startAzDeviceLogin } from "@/lib/az-bootstrap";
import {
  beginNativeDeviceSetup,
  beginPkceSetup,
  provisionFromAdminToken,
  publicDirectoryStatus,
  resolvePublicClientId,
  setupTenant,
} from "@/lib/entra";

export async function POST(req: Request) {
  const auth = await requireAdmin("integrations.manage");
  if (isResponse(auth)) return auth;
  const db = getDb();
  const already = publicDirectoryStatus(db);
  if (already.connected) {
    return NextResponse.json({ mode: "connected", ...already });
  }

  const body = (await req.json().catch(() => ({}))) as { clientId?: string };
  const origin = requestOrigin(req);
  const tenant = setupTenant(db);
  const clientId = resolvePublicClientId(db, body.clientId);
  const confidential = Boolean(process.env.AZURE_AD_CLIENT_SECRET);

  if (clientId && confidential) {
    return NextResponse.json(beginPkceSetup(db, origin, clientId, tenant));
  }

  if (clientId) {
    try {
      return NextResponse.json(await beginNativeDeviceSetup(db, clientId, tenant));
    } catch (error) {
      return NextResponse.json(
        { mode: "error", error: error instanceof Error ? error.message : "Could not start Microsoft sign-in" },
        { status: 400 },
      );
    }
  }

  const existingToken = await azGraphToken();
  if (existingToken) {
    try {
      const result = await provisionFromAdminToken(db, existingToken, origin, auth.session.email);
      return NextResponse.json({ mode: "connected", ...publicDirectoryStatus(getDb()), ...result });
    } catch (error) {
      return NextResponse.json(
        { mode: "error", error: error instanceof Error ? error.message : "Entra provisioning failed" },
        { status: 400 },
      );
    }
  }

  if (await azBinary()) {
    const state = randomUUID();
    const started = await startAzDeviceLogin(state);
    if ("error" in started) {
      return NextResponse.json({ mode: "error", error: started.error }, { status: 400 });
    }
    saveOauthState(db, state, "", "az", { tenant });
    return NextResponse.json({
      mode: "device",
      state,
      userCode: started.userCode,
      verificationUri: started.verificationUri,
      interval: 4,
      expiresIn: 900,
      via: "azure-cli",
    });
  }

  return NextResponse.json({
    mode: "missing-bootstrap",
    azAvailable: false,
    error:
      "PrivGate needs a Global Administrator sign-in to create the directory app. Install Azure CLI (`brew install azure-cli`), run Connect again, or set PRIVGATE_BOOTSTRAP_CLIENT_ID to a public client in this tenant.",
  });
}
