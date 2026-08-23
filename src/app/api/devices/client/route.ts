import { NextResponse } from "next/server";
import { appendAudit, getDb } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";
import { requestOrigin } from "@/lib/origin";
import { agentOriginFromWebOrigin } from "@/lib/listen";
import { enrollmentToken } from "@/lib/enrollment";
import {
  buildClientMsi,
  clientBinariesReady,
  clientMsiAvailable,
  deploymentScript,
  safeApiBase,
} from "@/lib/client-package";

export async function GET(req: Request) {
  const auth = await requireAdmin("devices.enroll");
  if (isResponse(auth)) return auth;
  const url = new URL(req.url);
  const format = (url.searchParams.get("format") || "").toLowerCase();
  const origin = requestOrigin(req);
  const apiBase = safeApiBase(url.searchParams.get("apiBase") || undefined, agentOriginFromWebOrigin(origin));
  const db = getDb();

  if (format === "status") {
    return NextResponse.json({
      apiBase,
      binaries: clientBinariesReady(),
      msi: clientMsiAvailable(),
    });
  }

  if (format === "script") {
    appendAudit(db, auth.session.email, "device.client-script", "fleet", { apiBase });
    return new NextResponse(deploymentScript(apiBase, enrollmentToken()), {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": 'attachment; filename="Install-PrivGate.ps1"',
        "cache-control": "no-store",
      },
    });
  }

  if (format === "msi") {
    try {
      const msi = buildClientMsi(apiBase);
      appendAudit(db, auth.session.email, "device.client-msi", "fleet", { apiBase });
      return new NextResponse(new Uint8Array(msi), {
        headers: {
          "content-type": "application/x-msi",
          "content-disposition": 'attachment; filename="PrivGate-Client.msi"',
          "cache-control": "no-store",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not build the MSI";
      return NextResponse.json({ error: message }, { status: 409 });
    }
  }

  return NextResponse.json({ error: "format must be script or msi" }, { status: 400 });
}
