import { NextResponse } from "next/server";
import { appendAudit, getDb } from "@/lib/db";
import { getDeviceGroup, setDeviceGroupPolicy } from "@/lib/db/device-groups";
import { isResponse, requireAdmin } from "@/lib/http";
import { isUpdateMode, normalizeSchedule } from "@/lib/update-policy";

/** PUT /api/devices/groups/[id]/policy — set a group's update policy. */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin("devices.update");
  if (isResponse(auth)) return auth;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { mode?: unknown; schedule?: unknown };

  if (typeof body.mode !== "string" || !isUpdateMode(body.mode)) {
    return NextResponse.json({ error: "mode must be auto | scheduled | manual" }, { status: 400 });
  }
  let schedule = "";
  if (body.mode === "scheduled") {
    schedule = normalizeSchedule(body.schedule);
    if (!schedule) {
      return NextResponse.json({ error: "schedule must be HH:MM when mode is scheduled" }, { status: 400 });
    }
  }

  const result = setDeviceGroupPolicy(getDb(), id, { mode: body.mode, schedule });
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "unknown group" }, { status: 404 });
  }
  const updated = getDeviceGroup(getDb(), id);
  appendAudit(getDb(), auth.session.email, "device-group.policy.update", id, {
    mode: body.mode,
    schedule,
    name: updated?.name,
  });
  return NextResponse.json({ ok: true });
}
