import { NextResponse } from "next/server";
import { bulkRequestAgentUpdates, selectStaleOnlineDevices } from "@/lib/agent-update";
import { getDb } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";

/** POST /api/devices/update-bulk — push agent updates to many devices at once. */
export async function POST(req: Request) {
  const auth = await requireAdmin("devices.update");
  if (isResponse(auth)) return auth;
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown; allStale?: unknown };
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((value): value is string => typeof value === "string")
    : [];
  if (!ids.length && body.allStale !== true) {
    return NextResponse.json({ error: "provide ids or allStale" }, { status: 400 });
  }
  const targets = body.allStale === true ? selectStaleOnlineDevices(getDb()) : ids;
  const summary = bulkRequestAgentUpdates(getDb(), targets, auth.session.email);
  return NextResponse.json(summary);
}
