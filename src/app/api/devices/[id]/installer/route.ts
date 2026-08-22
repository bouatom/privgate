import path from "node:path";
import { NextResponse } from "next/server";
import { appendAudit, getDb, getDevice } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto-secret";
import { isResponse, requireAdmin } from "@/lib/http";
import { requestOrigin } from "@/lib/origin";
import { buildInstallerEntries, installerFileName, safeApiBase } from "@/lib/device-installer";
import { ticketKeyForDevice } from "@/lib/evaluate";
import { deviceSecretKey } from "@/lib/secrets";
import { zipBuffers } from "@/lib/zip";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin("devices.enroll");
  if (isResponse(auth)) return auth;
  const { id } = await ctx.params;
  const db = getDb();
  const device = getDevice(db, id);
  if (!device) return NextResponse.json({ error: "unknown device" }, { status: 404 });

  const url = new URL(req.url);
  const origin = requestOrigin(req);
  const apiBase = safeApiBase(url.searchParams.get("apiBase") || undefined, origin);
  const secret = decryptSecret(device.secretEnc, deviceSecretKey());
  const zip = zipBuffers(
    buildInstallerEntries({
      hostname: device.hostname,
      deviceId: device.id,
      deviceSecret: secret,
      apiBase,
      ticketSigningKey: ticketKeyForDevice(device.id),
      agentRoot: path.join(process.cwd(), "agent"),
    }),
  );
  appendAudit(db, auth.session.email, "device.installer", device.id, { hostname: device.hostname, apiBase });
    return new NextResponse(new Uint8Array(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${installerFileName(device.hostname)}"`,
      "cache-control": "no-store",
    },
  });
}
