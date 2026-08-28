import { NextResponse } from "next/server";
import { appendAudit, getDb } from "@/lib/db";
import { deleteDeviceGroup, renameDeviceGroup } from "@/lib/db/device-groups";
import { isResponse, requireAdmin } from "@/lib/http";

/** PUT /api/devices/groups/[id] — rename / re-prioritize a device group. */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin("devices.update");
  if (isResponse(auth)) return auth;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; priority?: unknown };

  const patch: { name?: string; priority?: number } = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "name cannot be blank" }, { status: 400 });
    patch.name = name;
  }
  if (body.priority !== undefined) patch.priority = Number(body.priority) || 0;

  const result = renameDeviceGroup(getDb(), id, patch);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "unknown group" }, { status: result.error === "unknown group" ? 404 : 400 });
  }
  appendAudit(getDb(), auth.session.email, "device-group.update", id, patch);
  return NextResponse.json({ ok: true });
}

/** DELETE /api/devices/groups/[id] — remove a device group. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin("devices.update");
  if (isResponse(auth)) return auth;
  const { id } = await ctx.params;
  const result = deleteDeviceGroup(getDb(), id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "unknown group" }, { status: 404 });
  }
  appendAudit(getDb(), auth.session.email, "device-group.delete", id, {});
  return NextResponse.json({ ok: true });
}
