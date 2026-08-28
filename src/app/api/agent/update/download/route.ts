import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { verifyDeviceRequest } from "@/lib/device-auth";
import { appendAudit, getDb } from "@/lib/db";
import { consoleAgentOrigin } from "@/lib/listen";
import { buildClientMsi, safeApiBase } from "@/lib/client-package";

const DOWNLOAD_PATH = "/api/agent/update/download";

export async function GET(req: Request) {
  const auth = verifyDeviceRequest({
    deviceId: req.headers.get("x-device-id"),
    timestamp: req.headers.get("x-timestamp"),
    signature: req.headers.get("x-signature"),
    method: "GET",
    path: DOWNLOAD_PATH,
    rawBody: "",
  });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const url = new URL(req.url);
  // NEVER derive the ApiBase from the agent's request origin: the broker
  // requests the update from whatever ApiBase it is currently holding, so
  // echoing that back can preserve a stale/wildcard value (the field-test
  // `0.0.0.0:3001` self-reinforcing loop). Bake the console's own advertised
  // agent origin instead; the request-supplied value is still hardened by
  // safeApiBase as a last resort.
  const apiBase = safeApiBase(url.searchParams.get("apiBase") || undefined, consoleAgentOrigin());
  let msi: Buffer;
  try {
    msi = buildClientMsi(apiBase);
  } catch (error) {
    const message = error instanceof Error ? error.message : "client package unavailable";
    return NextResponse.json({ error: message }, { status: 409 });
  }

  const sha256 = createHash("sha256").update(msi).digest("hex");
  appendAudit(getDb(), `device:${auth.deviceId}`, "device.update.downloaded", auth.deviceId, {
    bytes: msi.length,
    sha256,
    apiBase,
  });
  return new NextResponse(new Uint8Array(msi), {
    headers: {
      "content-type": "application/x-msi",
      "content-disposition": 'attachment; filename="PrivGate-Client.msi"',
      "cache-control": "no-store",
      "x-update-sha256": sha256,
    },
  });
}
