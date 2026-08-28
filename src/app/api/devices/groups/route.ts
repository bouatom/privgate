import { NextResponse } from "next/server";
import { appendAudit, getDb } from "@/lib/db";
import { createDeviceGroup, getDeviceGroupByName, listDeviceGroups } from "@/lib/db/device-groups";
import { isResponse, requireAdmin } from "@/lib/http";

/** GET /api/devices/groups — list device groups. */
export async function GET() {
  const auth = await requireAdmin("devices.update");
  if (isResponse(auth)) return auth;
  return NextResponse.json({ groups: listDeviceGroups(getDb()) });
}

/** POST /api/devices/groups — create a device group. */
export async function POST(req: Request) {
  const auth = await requireAdmin("devices.update");
  if (isResponse(auth)) return auth;
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; priority?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (getDeviceGroupByName(getDb(), name)) {
    return NextResponse.json({ error: "a group with that name already exists" }, { status: 400 });
  }
  const priority = body.priority === undefined ? 0 : Number(body.priority) || 0;
  const group = createDeviceGroup(getDb(), name, priority);
  appendAudit(getDb(), auth.session.email, "device-group.create", group.id, { name, priority });
  return NextResponse.json(group, { status: 201 });
}
