import { NextResponse } from "next/server";
import { getDb, getElevationSettings, saveElevationSettings } from "@/lib/db";
import { auditConfigChange } from "@/lib/audit-helpers";
import { isResponse, requireAdmin, requireAny } from "@/lib/http";
import { parseUacMode } from "@/lib/uac-mode";
import { notifyUacMode } from "@/lib/realtime/notify";

export async function GET() {
  const auth = await requireAny(["policies.view", "policies.manage"]);
  if (isResponse(auth)) return auth;
  return NextResponse.json(getElevationSettings(getDb()));
}

export async function PUT(req: Request) {
  const auth = await requireAdmin("policies.manage");
  if (isResponse(auth)) return auth;
  const body = (await req.json().catch(() => ({}))) as { uacMode?: unknown };
  const db = getDb();
  const previous = getElevationSettings(db);
  const next = saveElevationSettings(db, parseUacMode(body.uacMode));
  auditConfigChange(db, auth.session.email, "elevation", "uac-mode", previous, next);
  notifyUacMode(next.uacMode);
  return NextResponse.json(next);
}
