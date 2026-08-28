import { NextResponse } from "next/server";
import { appendAudit, getDb } from "@/lib/db";
import { addGroupMembers, removeGroupMembers } from "@/lib/db/device-groups";
import { isResponse, requireAdmin } from "@/lib/http";

function parseDeviceIds(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const raw = (body as { deviceIds?: unknown }).deviceIds;
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is string => typeof value === "string");
}

/** POST /api/devices/groups/[id]/members — add devices to a group. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin("devices.update");
  if (isResponse(auth)) return auth;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const deviceIds = parseDeviceIds(body);
  if (!deviceIds.length) {
    return NextResponse.json({ error: "provide deviceIds" }, { status: 400 });
  }
  const added = addGroupMembers(getDb(), id, deviceIds);
  appendAudit(getDb(), auth.session.email, "device-group.members.add", id, { deviceIds, added });
  return NextResponse.json({ ok: true, added });
}

/** DELETE /api/devices/groups/[id]/members — remove devices from a group. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin("devices.update");
  if (isResponse(auth)) return auth;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const deviceIds = parseDeviceIds(body);
  if (!deviceIds.length) {
    return NextResponse.json({ error: "provide deviceIds" }, { status: 400 });
  }
  const removed = removeGroupMembers(getDb(), id, deviceIds);
  appendAudit(getDb(), auth.session.email, "device-group.members.remove", id, { deviceIds, removed });
  return NextResponse.json({ ok: true, removed });
}
