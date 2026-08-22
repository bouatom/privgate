import { NextResponse } from "next/server";
import { getDb, getOauthState, deleteOauthState } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";
import { requestOrigin } from "@/lib/origin";
import { pollAzDeviceLogin } from "@/lib/az-bootstrap";
import { pollNativeDeviceSetup, provisionFromAdminToken, publicDirectoryStatus } from "@/lib/entra";

export async function GET(req: Request) {
  const auth = await requireAdmin("PolicyAdmin");
  if (isResponse(auth)) return auth;
  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  if (!state) return NextResponse.json({ status: "error", error: "state required" }, { status: 400 });
  const db = getDb();
  const saved = getOauthState(db, state);
  if (!saved) {
    return NextResponse.json({ status: "error", error: "Sign-in expired. Start Connect Entra again." }, { status: 400 });
  }
  const origin = requestOrigin(req);

  if (saved.kind === "az") {
    const polled = pollAzDeviceLogin(state);
    if ("status" in polled) return NextResponse.json({ status: "pending" });
    deleteOauthState(db, state);
    if ("error" in polled) return NextResponse.json({ status: "error", error: polled.error });
    try {
      const result = await provisionFromAdminToken(db, polled.token, origin, auth.session.email);
      return NextResponse.json({ status: "connected", ...publicDirectoryStatus(getDb()), ...result });
    } catch (error) {
      return NextResponse.json({
        status: "error",
        error: error instanceof Error ? error.message : "Entra provisioning failed",
      });
    }
  }

  try {
    const result = await pollNativeDeviceSetup(db, state, origin, auth.session.email);
    if (result.status === "connected") {
      return NextResponse.json({ ...result, ...publicDirectoryStatus(getDb()) });
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      status: "error",
      error: error instanceof Error ? error.message : "Entra provisioning failed",
    });
  }
}
